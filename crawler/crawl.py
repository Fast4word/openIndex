from __future__ import annotations

import ipaddress
import os
import re
import socket
import sys
import time
import xml.etree.ElementTree as ET
from collections import defaultdict
from urllib.parse import urljoin, urlsplit, urlunsplit
from urllib.robotparser import RobotFileParser

import requests
import trafilatura
from bs4 import BeautifulSoup

API_URL = os.environ.get("SEARCH_API_URL", "").rstrip("/")
INGEST_SECRET = os.environ.get("INGEST_SECRET", "")
MAX_PAGES = max(1, min(40, int(os.environ.get("MAX_PAGES", "24"))))
USER_AGENT = os.environ.get(
    "CRAWLER_USER_AGENT",
    "OpenIndexBot/0.1 (+https://github.com/Fast4word/openIndex)",
)
MAX_BODY_CHARS = 20000
MAX_LINKS_PER_PAGE = 120
MAX_DISCOVERED_PER_RUN = 300
DEFAULT_DELAY = 2.0
SKIP_EXTENSIONS = {
    ".7z", ".avi", ".bin", ".css", ".csv", ".doc", ".docx", ".eot", ".exe",
    ".gif", ".gz", ".ico", ".jpeg", ".jpg", ".js", ".json", ".mp3", ".mp4",
    ".odp", ".ods", ".odt", ".png", ".ppt", ".pptx", ".rar", ".rss", ".svg",
    ".tar", ".tif", ".tiff", ".ttf", ".webm", ".webp", ".woff", ".woff2",
    ".xls", ".xlsx", ".zip",
}

session = requests.Session()
session.headers.update({
    "User-Agent": USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5",
})
robots_cache: dict[str, tuple[RobotFileParser, list[str]]] = {}
last_request_by_host: dict[str, float] = defaultdict(float)


def api(path: str, payload: dict | None = None, method: str = "GET") -> dict:
    if not API_URL or not INGEST_SECRET:
        raise RuntimeError("Set SEARCH_API_URL and INGEST_SECRET in GitHub Actions secrets.")
    headers = {"Authorization": f"Bearer {INGEST_SECRET}"}
    if method == "GET":
        response = session.get(f"{API_URL}{path}", headers=headers, timeout=30)
    else:
        response = session.post(f"{API_URL}{path}", json=payload or {}, headers=headers, timeout=60)
    response.raise_for_status()
    return response.json()


def normalise_url(raw: str, base: str | None = None) -> str | None:
    if not raw or len(raw) > 2048:
        return None
    try:
        joined = urljoin(base, raw) if base else raw
        parsed = urlsplit(joined)
        if parsed.scheme.lower() not in {"http", "https"} or not parsed.hostname:
            return None
        if parsed.username or parsed.password:
            return None
        host = parsed.hostname.lower().rstrip(".")
        if host in {"localhost", "localhost.localdomain"} or host.endswith((".local", ".internal", ".test", ".invalid")):
            return None
        try:
            address = ipaddress.ip_address(host)
            if not address.is_global:
                return None
        except ValueError:
            if "." not in host:
                return None
        path = parsed.path or "/"
        suffix = path.lower().rsplit("/", 1)[-1]
        if any(suffix.endswith(ext) for ext in SKIP_EXTENSIONS):
            return None
        # Drop query strings in v1 to avoid crawling tracking and search-result traps.
        clean = urlunsplit((parsed.scheme.lower(), parsed.netloc.lower(), path, "", ""))
        if len(clean) > 2048:
            return None
        return clean
    except (ValueError, TypeError):
        return None


def resolves_only_to_public_ips(url: str) -> bool:
    """Reject hosts that resolve to loopback, private, link-local or reserved IPs.

    This is a defensive SSRF safeguard for a crawler running on hosted CI machines.
    It checks every address returned by DNS and fails closed on lookup errors.
    """
    host = urlsplit(url).hostname
    if not host:
        return False
    try:
        direct = ipaddress.ip_address(host)
        return direct.is_global
    except ValueError:
        pass
    try:
        addresses = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
    except (OSError, socket.gaierror):
        return False
    if not addresses:
        return False
    for address in addresses:
        try:
            ip = ipaddress.ip_address(address[4][0].split("%", 1)[0])
        except ValueError:
            return False
        if not ip.is_global:
            return False
    return True


def origin_for(url: str) -> str:
    p = urlsplit(url)
    return f"{p.scheme}://{p.netloc}"


def robots_for(url: str) -> tuple[RobotFileParser, list[str]]:
    origin = origin_for(url)
    if origin in robots_cache:
        return robots_cache[origin]
    parser = RobotFileParser()
    robots_url = f"{origin}/robots.txt"
    sitemap_urls: list[str] = []
    try:
        response = session.get(robots_url, timeout=(8, 15), allow_redirects=False)
        if response.status_code in (404, 410):
            parser.parse([])
        elif response.status_code == 200:
            lines = response.text.splitlines()
            parser.set_url(robots_url)
            parser.parse(lines)
            for line in lines:
                if line.lower().startswith("sitemap:"):
                    candidate = normalise_url(line.split(":", 1)[1].strip())
                    if candidate:
                        sitemap_urls.append(candidate)
        else:
            # Fail closed on robots errors other than a clear 404/410.
            parser.parse(["User-agent: *", "Disallow: /"])
    except requests.RequestException:
        parser.parse(["User-agent: *", "Disallow: /"])
    robots_cache[origin] = (parser, sitemap_urls)
    return parser, sitemap_urls


def wait_for_host(url: str, parser: RobotFileParser) -> None:
    host = urlsplit(url).netloc.lower()
    delay = parser.crawl_delay(USER_AGENT) or parser.crawl_delay("*") or DEFAULT_DELAY
    try:
        delay = max(DEFAULT_DELAY, min(float(delay), 30.0))
    except (TypeError, ValueError):
        delay = DEFAULT_DELAY
    now = time.monotonic()
    wait = last_request_by_host[host] + delay - now
    if wait > 0:
        time.sleep(wait)
    last_request_by_host[host] = time.monotonic()


def get_page(start_url: str):
    current = start_url
    for _ in range(6):
        if not resolves_only_to_public_ips(current):
            return None, current, [], "host does not resolve exclusively to public IP addresses", True
        parser, sitemaps = robots_for(current)
        if not parser.can_fetch(USER_AGENT, current):
            return None, current, sitemaps, "robots.txt disallows this URL", True
        wait_for_host(current, parser)
        try:
            response = session.get(current, timeout=(8, 20), allow_redirects=False, stream=True)
        except requests.RequestException as exc:
            return None, current, sitemaps, str(exc)[:180], False
        if response.is_redirect or response.is_permanent_redirect:
            location = response.headers.get("Location")
            response.close()
            target = normalise_url(location, current) if location else None
            if not target:
                return None, current, sitemaps, "invalid redirect", True
            current = target
            continue
        return response, current, sitemaps, None, False
    return None, current, [], "too many redirects", True


def read_limited(response: requests.Response, max_bytes: int = 5_000_000) -> bytes:
    chunks: list[bytes] = []
    total = 0
    for chunk in response.iter_content(chunk_size=64 * 1024):
        if not chunk:
            continue
        remaining = max_bytes - total
        if remaining <= 0:
            break
        chunks.append(chunk[:remaining])
        total += min(len(chunk), remaining)
        if total >= max_bytes:
            break
    return b"".join(chunks)


def extract_sitemap(xml_text: str, base_url: str) -> list[str]:
    found: list[str] = []
    try:
        root = ET.fromstring(xml_text[:5_000_000])
        for element in root.iter():
            if element.tag.lower().endswith("}loc") or element.tag.lower() == "loc":
                if element.text:
                    candidate = normalise_url(element.text.strip(), base_url)
                    if candidate:
                        found.append(candidate)
                        if len(found) >= 200:
                            break
    except ET.ParseError:
        pass
    return found


def parse_html(html: str, page_url: str) -> tuple[dict | None, list[str]]:
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript", "svg", "form"]):
        tag.decompose()

    title = ""
    if soup.title and soup.title.get_text(strip=True):
        title = soup.title.get_text(" ", strip=True)
    if not title:
        h1 = soup.find("h1")
        title = h1.get_text(" ", strip=True) if h1 else page_url

    description = ""
    meta = soup.find("meta", attrs={"name": re.compile("^description$", re.I)})
    if not meta:
        meta = soup.find("meta", attrs={"property": "og:description"})
    if meta and meta.get("content"):
        description = str(meta.get("content")).strip()

    links: list[str] = []
    base_tag = soup.find("base", href=True)
    link_base = urljoin(page_url, base_tag["href"]) if base_tag else page_url
    for anchor in soup.find_all("a", href=True):
        candidate = normalise_url(anchor.get("href", ""), link_base)
        if candidate and candidate != page_url:
            links.append(candidate)
        if len(links) >= MAX_LINKS_PER_PAGE:
            break

    extracted = trafilatura.extract(
        html,
        url=page_url,
        include_comments=False,
        include_tables=True,
        favor_precision=True,
        output_format="txt",
    ) or ""
    body = re.sub(r"\s+", " ", extracted).strip()[:MAX_BODY_CHARS]
    if len(body) < 120:
        return None, links

    page = {
        "url": page_url,
        "title": title[:400] or page_url,
        "description": description[:900],
        "body": body,
    }
    return page, links


def main() -> int:
    if not API_URL or not INGEST_SECRET:
        print("Missing SEARCH_API_URL or INGEST_SECRET.", file=sys.stderr)
        return 2

    seed_file = os.path.join(os.path.dirname(__file__), "..", "seeds.txt")
    with open(seed_file, "r", encoding="utf-8") as file:
        seeds = [normalise_url(line.strip()) for line in file if line.strip() and not line.lstrip().startswith("#")]
    seeds = [item for item in seeds if item]
    if seeds:
        queued = api("/internal/queue", {"urls": seeds}, method="POST")
        print(f"Seed URLs submitted: {queued.get('accepted', 0)}")

    next_batch = api(f"/internal/next?limit={MAX_PAGES}")
    urls = next_batch.get("urls", [])
    print(f"URLs selected for this run: {len(urls)}")
    if not urls:
        print("No URLs are due for crawling.")
        return 0

    pages: list[dict] = []
    completed: list[str] = []
    failed: list[dict] = []
    discovered: list[str] = []
    discovered_set: set[str] = set()

    def add_discovered(candidates):
        for candidate in candidates:
            clean = normalise_url(candidate)
            if clean and clean not in discovered_set and len(discovered) < MAX_DISCOVERED_PER_RUN:
                discovered_set.add(clean)
                discovered.append(clean)

    for index, url in enumerate(urls, start=1):
        print(f"[{index}/{len(urls)}] {url}")
        response, final_url, sitemaps, error, permanent = get_page(url)
        add_discovered(sitemaps)
        if error:
            print(f"  skipped: {error}")
            failed.append({"url": url, "permanent": permanent})
            continue
        try:
            content_type = (response.headers.get("Content-Type") or "").lower()
            if response.status_code >= 400:
                failed.append({"url": url, "permanent": response.status_code < 500})
                print(f"  HTTP {response.status_code}")
                continue
            body_bytes = read_limited(response)
            text = body_bytes.decode(response.encoding or "utf-8", errors="replace")
            if "xml" in content_type or final_url.lower().endswith(".xml"):
                add_discovered(extract_sitemap(text, final_url))
                completed.append(url)
                print("  sitemap processed")
            elif "html" in content_type or "xhtml" in content_type or "<html" in text[:1000].lower():
                page, links = parse_html(text, final_url)
                add_discovered(links)
                completed.append(url)
                if page:
                    pages.append(page)
                    print(f"  extracted {len(page['body'])} characters; {len(links)} links")
                else:
                    print("  no useful article text; URL marked visited")
            else:
                completed.append(url)
                print("  non-HTML resource skipped")
        finally:
            response.close()

    payload = {
        "pages": pages,
        "completed": completed,
        "failed": failed,
        "discovered": discovered,
    }
    result = api("/internal/ingest", payload, method="POST")
    print(
        "Run complete: "
        f"{len(pages)} pages indexed, {len(discovered)} new links submitted, "
        f"{len(failed)} fetch failures. API response: {result}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
