const PAGE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#101827">
  <meta name="description" content="Search an independently built web index.">
  <title>OpenIndex — Independent Web Search</title>
  <style>
    :root{color-scheme:dark;--bg:#0b1220;--panel:#111c2e;--muted:#9aabc1;--text:#eff5ff;--line:#29384d;--accent:#79a9ff;--green:#63d6ac}
    *{box-sizing:border-box}body{margin:0;background:radial-gradient(ellipse at top,#182a45 0,#0b1220 48rem);color:var(--text);font:16px/1.55 system-ui,-apple-system,Segoe UI,sans-serif;min-height:100vh}
    main{width:min(850px,calc(100% - 32px));margin:0 auto;padding:10vh 0 64px}.brand{font-size:clamp(2.5rem,8vw,4.2rem);font-weight:800;letter-spacing:-.06em;margin:0;text-align:center}.brand span{color:var(--accent)}.tagline{text-align:center;color:var(--muted);margin:4px 0 32px}
    form{display:flex;gap:8px;padding:8px;border:1px solid var(--line);background:rgba(17,28,46,.95);border-radius:16px;box-shadow:0 16px 60px #0005}input{min-width:0;flex:1;background:transparent;border:0;outline:0;color:var(--text);padding:12px;font-size:17px}button{border:0;border-radius:11px;background:var(--accent);color:#081322;padding:0 22px;font-weight:750;font-size:15px;cursor:pointer}button:disabled{opacity:.6;cursor:wait}
    .stats{text-align:center;color:var(--muted);font-size:13px;margin:14px 0 40px}.results{display:grid;gap:18px}.result{padding:16px 18px;border:1px solid var(--line);border-radius:14px;background:rgba(17,28,46,.72)}.result a{color:var(--accent);text-decoration:none;font-size:19px;font-weight:650}.result a:hover{text-decoration:underline}.url{font-size:12px;color:var(--green);overflow-wrap:anywhere;margin:3px 0 8px}.snippet{color:#c4d0df;margin:0}.meta{color:var(--muted);font-size:12px;margin-top:8px}.status{text-align:center;color:var(--muted);padding:18px}.footer{text-align:center;color:#72839a;font-size:12px;margin-top:48px}.footer a{color:#a8c5ff}
    @media(max-width:520px){main{padding-top:8vh}form{gap:4px}input{font-size:16px;padding:10px 7px}button{padding:0 14px}.result{padding:14px}}
  </style>
</head>
<body>
<main>
  <h1 class="brand">Open<span>Index</span></h1>
  <p class="tagline">An independent search index, built one page at a time.</p>
  <form id="search-form">
    <input id="query" type="search" placeholder="Search the web…" autocomplete="off" aria-label="Search the web">
    <button id="submit" type="submit">Search</button>
  </form>
  <div id="stats" class="stats">Loading index statistics…</div>
  <section id="results" class="results" aria-live="polite"></section>
  <div class="footer">Independent index · Results link to their original publishers</div>
</main>
<script>
const form=document.getElementById('search-form');
const input=document.getElementById('query');
const button=document.getElementById('submit');
const results=document.getElementById('results');
const stats=document.getElementById('stats');
function element(tag,className,text){const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;}
async function loadStats(){try{const r=await fetch('/api/stats');if(!r.ok)throw new Error('stats');const d=await r.json();stats.textContent=Number(d.documents||0).toLocaleString()+' pages independently indexed';}catch{stats.textContent='Independent web index';}}
function render(items){results.replaceChildren();if(!items.length){results.append(element('p','status','No matching pages in this index yet. Try another query or check back as the index grows.'));return;}
  for(const item of items){const card=element('article','result');const link=element('a','',item.title||item.url);link.href=item.url;link.target='_blank';link.rel='noopener noreferrer';const domain=element('div','url',item.domain||'');const excerpt=element('p','snippet',item.snippet||item.description||'');const meta=element('div','meta',item.crawled_at?'Indexed '+new Date(item.crawled_at).toLocaleDateString(): '');card.append(link,domain,excerpt,meta);results.append(card);}}
form.addEventListener('submit',async event=>{event.preventDefault();const q=input.value.trim();if(!q)return;button.disabled=true;button.textContent='Searching…';results.replaceChildren(element('p','status','Searching your independent index…'));try{const response=await fetch('/api/search?q='+encodeURIComponent(q));const data=await response.json();if(!response.ok)throw new Error(data.error||'Search failed');render(data.results||[]);}catch(error){results.replaceChildren(element('p','status',error.message||'Search failed. Please try again.'));}finally{button.disabled=false;button.textContent='Search';}});
loadStats();
</script>
</body></html>`;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS }
  });
}

function normaliseUrl(raw) {
  if (typeof raw !== "string" || raw.length > 2048) return null;
  try {
    const u = new URL(raw);
    if (!["http:", "https:"].includes(u.protocol) || u.username || u.password) return null;
    if (!u.hostname || u.hostname === "localhost" || u.hostname.endsWith(".local")) return null;
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

function validSecret(request, env) {
  const expected = env.INGEST_SECRET;
  const supplied = request.headers.get("Authorization") || "";
  return Boolean(expected && supplied === `Bearer ${expected}`);
}

async function insertQueue(env, urls, priority = 0) {
  const statements = [];
  for (const raw of urls) {
    const url = normaliseUrl(raw);
    if (!url) continue;
    const domain = new URL(url).hostname.toLowerCase();
    statements.push(env.DB.prepare(
      "INSERT OR IGNORE INTO crawl_queue (url, domain, status, attempts, priority, added_at) VALUES (?, ?, 'pending', 0, ?, unixepoch())"
    ).bind(url, domain, priority));
  }
  let inserted = 0;
  for (let i = 0; i < statements.length; i += 400) {
    const batch = statements.slice(i, i + 400);
    if (batch.length) await env.DB.batch(batch);
    inserted += batch.length;
  }
  return inserted;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

    if (url.pathname === "/" && request.method === "GET") {
      return new Response(PAGE, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
    }
    if (url.pathname === "/health" && request.method === "GET") return json({ ok: true, service: "openindex" });

    if (url.pathname === "/api/stats" && request.method === "GET") {
      try {
        const row = await env.DB.prepare("SELECT COUNT(*) AS documents FROM documents").first();
        return json({ documents: row?.documents || 0 });
      } catch {
        return json({ error: "Index database is not ready. Apply schema.sql first." }, 503);
      }
    }

    if (url.pathname === "/api/search" && request.method === "GET") {
      const q = (url.searchParams.get("q") || "").trim().slice(0, 160);
      if (!q) return json({ results: [] });
      const tokens = [...new Set(q.normalize("NFKC").match(/[\p{L}\p{N}]{2,}/gu) || [])].slice(0, 8);
      if (!tokens.length) return json({ results: [] });
      const match = tokens.map(token => `"${token.replaceAll('"', '""')}"*`).join(" OR ");
      const limit = Math.max(1, Math.min(20, Number(url.searchParams.get("limit")) || 10));
      try {
        const result = await env.DB.prepare(`
          SELECT d.url, d.title, d.description, d.domain, d.crawled_at,
                 snippet(documents_fts, 2, '', '', ' … ', 24) AS snippet
          FROM documents_fts
          JOIN documents d ON d.id = documents_fts.rowid
          WHERE documents_fts MATCH ?
          ORDER BY bm25(documents_fts, 8.0, 3.0, 1.0) ASC
          LIMIT ?
        `).bind(match, limit).all();
        return json({ query: q, results: result.results || [] });
      } catch (error) {
        return json({ error: "Search is temporarily unavailable. Check that schema.sql was applied." }, 503);
      }
    }

    if (url.pathname.startsWith("/internal/")) {
      if (!validSecret(request, env)) return json({ error: "Unauthorised" }, 401);

      if (url.pathname === "/internal/queue" && request.method === "POST") {
        let body;
        try {
          body = await request.json();
        } catch {
          return json({ error: "Invalid JSON queue payload" }, 400);
        }
        try {
          const urls = Array.isArray(body.urls) ? body.urls.slice(0, 200) : [];
          const count = await insertQueue(env, urls, 10);
          return json({ accepted: count });
        } catch (error) {
          // This endpoint is authenticated. Include a short diagnostic so a
          // missing D1 table/binding can be fixed without exposing secrets.
          console.error("OpenIndex queue database error", error);
          return json({
            error: "Queue database operation failed",
            detail: String(error?.message || error).slice(0, 400)
          }, 500);
        }
      }

      if (url.pathname === "/internal/next" && request.method === "GET") {
        const limit = Math.max(1, Math.min(40, Number(url.searchParams.get("limit")) || 24));
        const result = await env.DB.prepare(`
          SELECT url FROM (
            SELECT url, priority, added_at, COALESCE(last_crawled_at, 0) AS last_seen,
                   ROW_NUMBER() OVER (PARTITION BY domain ORDER BY priority DESC, COALESCE(last_crawled_at, 0) ASC, added_at ASC, url ASC) AS host_rank
            FROM crawl_queue
            WHERE (status = 'pending' AND attempts < 4)
               OR (status = 'done' AND last_crawled_at < unixepoch() - 2592000)
          )
          WHERE host_rank <= 2
          ORDER BY priority DESC, last_seen ASC, added_at ASC, url ASC
          LIMIT ?
        `).bind(limit).all();
        return json({ urls: (result.results || []).map(row => row.url) });
      }

      if (url.pathname === "/internal/ingest" && request.method === "POST") {
        try {
          const body = await request.json();
          const pages = Array.isArray(body.pages) ? body.pages.slice(0, 30) : [];
          const completed = Array.isArray(body.completed) ? body.completed.slice(0, 40) : [];
          const failed = Array.isArray(body.failed) ? body.failed.slice(0, 40) : [];
          const discovered = Array.isArray(body.discovered) ? body.discovered.slice(0, 300) : [];
          const statements = [];
          const now = new Date().toISOString();

          for (const page of pages) {
            const safeUrl = normaliseUrl(page.url);
            if (!safeUrl) continue;
            const domain = new URL(safeUrl).hostname.toLowerCase();
            const title = String(page.title || safeUrl).slice(0, 400);
            const description = String(page.description || "").slice(0, 900);
            const text = String(page.body || "").slice(0, 20000);
            if (text.length < 80) continue;
            statements.push(env.DB.prepare(`
              INSERT INTO documents (url, title, description, body, domain, crawled_at)
              VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(url) DO UPDATE SET
                title=excluded.title,
                description=excluded.description,
                body=excluded.body,
                domain=excluded.domain,
                crawled_at=excluded.crawled_at
            `).bind(safeUrl, title, description, text, domain, now));
            statements.push(env.DB.prepare("UPDATE crawl_queue SET status='done', attempts=0, last_crawled_at=unixepoch() WHERE url=?").bind(safeUrl));
          }

          const pageUrls = new Set(pages.map(page => normaliseUrl(page.url)).filter(Boolean));
          for (const raw of completed) {
            const safeUrl = normaliseUrl(raw);
            if (safeUrl && !pageUrls.has(safeUrl)) {
              statements.push(env.DB.prepare("UPDATE crawl_queue SET status='done', attempts=0, last_crawled_at=unixepoch() WHERE url=?").bind(safeUrl));
            }
          }
          for (const item of failed) {
            if (!item || typeof item.url !== "string") continue;
            const safeUrl = normaliseUrl(item.url);
            if (!safeUrl) continue;
            const status = item.permanent ? "skipped" : null;
            statements.push(status
              ? env.DB.prepare("UPDATE crawl_queue SET status='skipped', attempts=attempts+1 WHERE url=?").bind(safeUrl)
              : env.DB.prepare("UPDATE crawl_queue SET attempts=attempts+1, status=CASE WHEN attempts+1 >= 4 THEN 'failed' ELSE 'pending' END WHERE url=?").bind(safeUrl));
          }

          for (const raw of discovered) {
            const safeUrl = normaliseUrl(raw);
            if (!safeUrl) continue;
            const domain = new URL(safeUrl).hostname.toLowerCase();
            statements.push(env.DB.prepare(
              "INSERT OR IGNORE INTO crawl_queue (url, domain, status, attempts, priority, added_at) VALUES (?, ?, 'pending', 0, 0, unixepoch())"
            ).bind(safeUrl, domain));
          }

          for (let i = 0; i < statements.length; i += 400) {
            const batch = statements.slice(i, i + 400);
            if (batch.length) await env.DB.batch(batch);
          }
          return json({ indexed: pages.length, discovered: discovered.length, completed: completed.length, failed: failed.length });
        } catch {
          return json({ error: "Invalid ingest payload" }, 400);
        }
      }
    }

    return json({ error: "Not found" }, 404);
  }
};
