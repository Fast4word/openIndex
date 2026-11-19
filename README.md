# OpenIndex — independent web search

OpenIndex is an independent search-engine prototype. It crawls websites itself, stores extracted pages in its own Cloudflare D1 database and searches that index using SQLite FTS5/BM25. It does not fetch search results from Google, Bing, Mojeek, Mwmbl or another search API.

## Built for a Chromebook — no Linux or terminal

Everything can be managed in browser-based dashboards:

- **GitHub** stores the source and runs the crawler using GitHub Actions.
- **Cloudflare Workers** serves the search website and API.
- **Cloudflare D1** stores documents, the crawl queue and the full-text index.
- **GitHub Actions** uses GitHub-hosted machines, not your Chromebook. Standard hosted runners are free and unlimited for public repositories.

This starter is a small first step, not a Google-scale web index. Free hosting has storage, request and database limits.

## Browser-only setup

### 1. Create and initialise the D1 database

1. Sign in at https://dash.cloudflare.com/.
2. Open **Storage & databases → D1 SQL Database** and create a database named **openindex-db**.
3. Open the database's **Console**.
4. Open **schema.sql** in this GitHub repository, select **Raw**, copy the complete SQL, paste it into the D1 Console and select **Execute**.

Cloudflare documents database creation and its browser SQL Console here: https://developers.cloudflare.com/d1/get-started/

### 2. Add the database ID to the project

1. Copy the **Database ID** from the D1 database overview.
2. In GitHub, open **wrangler.jsonc**, select the pencil icon and replace **REPLACE_WITH_D1_DATABASE_ID** with your ID, keeping the quotation marks.
3. Commit the change to **main**.

A database ID is an identifier, not a password. Never put API tokens or secret values in source files.

### 3. Deploy the Worker directly from GitHub

1. In Cloudflare, open **Workers & Pages → Create application → GitHub**.
2. Authorise the Cloudflare Workers & Pages GitHub App if prompted, and grant it access to **Fast4word/openIndex**.
3. Select this repository and the **main** branch. Set the root directory to **/**.
4. Use **npm install** as the build command and **npm run deploy** as the deploy command if Cloudflare does not detect the commands automatically. The included package.json installs Wrangler.
5. Save and deploy. The Worker name is **openindex-search**, as set in wrangler.jsonc.
6. Open the **workers.dev** URL Cloudflare provides. You should see the OpenIndex search page.

Cloudflare's official Git integration instructions: https://developers.cloudflare.com/workers/ci-cd/builds/

### 4. Create the private ingestion secret

1. Generate a long random value using a password manager.
2. In the **openindex-search** Worker, open **Settings → Variables and Secrets**.
3. Add a secret named **INGEST_SECRET** and save it.
4. Keep this value private. Do not commit it to GitHub or put it in browser JavaScript.

### 5. Connect GitHub Actions to the Worker

In GitHub, open **Fast4word/openIndex → Settings → Secrets and variables → Actions** and add two repository secrets:

- **SEARCH_API_URL** — the Worker base URL, such as https://openindex-search.YOUR-SUBDOMAIN.workers.dev, without a trailing slash.
- **INGEST_SECRET** — exactly the same value you added to the Cloudflare Worker.

Open the **Actions** tab, enable workflows if GitHub asks, choose **Crawl and update OpenIndex**, then select **Run workflow**. Check the run logs. The workflow is also scheduled every three hours.

GitHub's hosted-runner pricing rules: https://docs.github.com/en/actions/reference/runners/github-hosted-runners

### 6. Identify your crawler

The default User-Agent identifies this project as **OpenIndexBot/0.1** and links to this repository. Before expanding the crawl, you can edit **CRAWLER_USER_AGENT** in **.github/workflows/crawl.yml** to include a public contact email or contact page.

Edit **seeds.txt** in GitHub to add or remove discovery starting points. The crawler follows links it discovers, so seeds are starting points rather than a fixed domain allow-list.

## Crawler behaviour

- Reads starting URLs from seeds.txt, then discovers links and XML sitemaps.
- Checks robots.txt before crawling. If it cannot retrieve robots instructions reliably, it fails closed and skips that host.
- Waits at least two seconds between page requests to the same host.
- Rejects hosts that resolve to private, loopback, link-local or reserved IP addresses.
- Processes up to 24 URLs per run and queues a limited number of discovered links.
- Skips common binary file types and strips URL query strings in this first version.
- Extracts page title, description and main text. Search results link to the original page and show a short snippet.
- Re-crawls successfully processed URLs after about 30 days.

robots.txt is a crawling signal, not a copyright licence. Respect site terms, rate limits, publisher rights and removal requests. Do not assume permission to republish protected text, images or other content. The index stores extracted text for matching; the public interface displays links and short snippets.

## Search endpoints

- / — search website
- /health — Worker health check
- /api/stats — indexed document count
- /api/search?q=your+query — public JSON search API

Search currently uses SQLite FTS5/BM25 with stronger weighting for title matches. It is a starting ranking model; it does not yet use a global link graph, advanced spam detection or language-specific ranking.

## Free-tier limits

Cloudflare's current D1 Free limits include 500 MB per database, 5 GB total D1 storage per account, 5 million rows read per day and 100,000 rows written per day. Workers Free also has a daily request allowance. Limits and plan terms can change; monitor usage in the Cloudflare dashboard.

- D1 limits: https://developers.cloudflare.com/d1/platform/limits/
- D1 pricing: https://developers.cloudflare.com/d1/platform/pricing/
- Workers pricing: https://developers.cloudflare.com/workers/platform/pricing/

The repository is public so standard GitHub-hosted runners can be used without a private-repository minutes allowance. Never store secrets in source files or commits.

## Troubleshooting

- **Database not ready:** confirm schema.sql executed successfully in the D1 Console.
- **Worker deployment fails:** check that wrangler.jsonc has the correct D1 ID and the project root is selected.
- **Crawler returns 401:** the Cloudflare and GitHub INGEST_SECRET values must match exactly.
- **Crawler cannot connect:** SEARCH_API_URL must be the Worker base URL, without /api or a trailing slash.
- **No pages indexed:** inspect the Actions log. A site may disallow crawling, block automated requests, return non-HTML or have too little extractable text.
- **Scheduled crawls stop:** check that the workflow is enabled in Actions. GitHub may delay scheduled workflows.

## Project files

- crawler/crawl.py — crawler and content extraction
- crawler/requirements.txt — Python dependencies
- .github/workflows/crawl.yml — scheduled and manual crawl
- src/index.js — Worker, search website and authenticated ingestion API
- schema.sql — D1 schema and FTS5 triggers
- seeds.txt — discovery starting points
- wrangler.jsonc — Worker and D1 binding
- package.json — browser-deployed Worker tooling
- SETUP-CHECKLIST.md — setup checklist

## Licence

This repository retains its existing **GNU General Public License v3.0** licence.
