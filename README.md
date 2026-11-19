# OpenIndex — independent web search

OpenIndex is a small, independent search engine prototype. It builds and searches its **own** index: it does not fetch search results from Google, Bing, Mojeek, Mwmbl or another search API.

## Built for a Chromebook — no Linux or terminal required

You can manage the whole project in browser-based dashboards:

- **GitHub** stores the source and provides free hosted runners for the crawler. The repository needs to be public to use standard GitHub-hosted runners without consuming a private-repository allowance.
- **GitHub Actions** runs the Python crawler on GitHub's machines, not on your Chromebook.
- **Cloudflare Workers** serves the search website and API.
- **Cloudflare D1** stores pages, crawl queue data and the SQLite FTS5 full-text index.

The first target is a modest, useful index—not a Google-scale copy of the internet. The free infrastructure has storage, request and daily database limits.

## Browser-only setup

### 1. Create your D1 database

1. Sign in to the Cloudflare dashboard at https://dash.cloudflare.com/.
2. Open **Storage & databases → D1 SQL Database**.
3. Select **Create database** and name it **openindex-db**.
4. Open the database and choose **Console**.
5. Open schema.sql in this GitHub repository, select **Raw**, copy the entire SQL file, paste it into the D1 Console and choose **Execute**.

The schema creates the documents table, crawler queue, FTS5 search index and the triggers that keep the full-text index synchronised.

Cloudflare's D1 dashboard supports creating a database and executing SQL in its Console: https://developers.cloudflare.com/d1/get-started/

### 2. Connect the database to the code

1. In the D1 database overview, copy its **Database ID**.
2. In this GitHub repository, open **wrangler.jsonc** and select the pencil icon to edit it.
3. Replace REPLACE_WITH_D1_DATABASE_ID with the Database ID you copied. Keep the quotation marks.
4. Commit the change to the main branch.

Do not paste API tokens or other secrets into this file. The database ID is an identifier, not a password.

### 3. Deploy the search website from GitHub

1. In Cloudflare, open **Workers & Pages**.
2. Select **Create application**, then choose **GitHub**.
3. Authorise Cloudflare's Workers & Pages GitHub App if prompted, giving it access to the Fast4word/openIndex repository.
4. Select the **Fast4word/openIndex** repository and the **main** branch.
5. Use the repository root as the root directory. The project already includes wrangler.jsonc.
6. Save and deploy. Cloudflare should build and deploy the Worker named **openindex-search**.
7. Open the workers.dev URL Cloudflare gives you. The OpenIndex search page should appear.

Cloudflare's official Git integration guide: https://developers.cloudflare.com/workers/ci-cd/builds/

### 4. Add the private ingestion secret

The crawler must authenticate before it can add URLs or pages. Create one long random secret using a password manager's password generator.

1. In Cloudflare, open the **openindex-search** Worker.
2. Open **Settings → Variables and Secrets** (the label can vary slightly).
3. Add a secret named **INGEST_SECRET** and paste the random value. Save it and allow Cloudflare to redeploy if prompted.
4. Keep this value private. Never commit it to the repository or put it in browser JavaScript.

### 5. Connect GitHub Actions to the Worker

1. In GitHub, open **Fast4word/openIndex → Settings → Secrets and variables → Actions**.
2. Add a repository secret named **SEARCH_API_URL**. Its value is the Worker base URL, for example https://openindex-search.YOUR-SUBDOMAIN.workers.dev. Do not add a trailing slash or /api path.
3. Add a repository secret named **INGEST_SECRET** with exactly the same random value you saved in Cloudflare.
4. Open the **Actions** tab. Enable workflows if GitHub asks.
5. Choose **Crawl and update OpenIndex**, then choose **Run workflow**.

The crawler will submit the seed URLs, fetch a small batch of pages and send extracted text to your D1 database. Check the workflow run logs to see what was indexed. The workflow is also scheduled to run every three hours.

GitHub documents standard hosted runners as free and unlimited for public repositories: https://docs.github.com/en/actions/reference/runners/github-hosted-runners

### 6. Make the crawler identifiable

The crawler uses an identifiable User-Agent string containing this repository URL. Before broadening the crawl, consider adding a public contact email to USER_AGENT in crawler/crawl.py and committing the change. This helps website operators identify the crawler and contact you.

Change the starting points in seeds.txt using GitHub's web editor. The crawler follows links it discovers, so seed sites are discovery starting points—not a closed allow-list.

## How the crawler behaves

- Starts from seeds.txt and URLs found in permitted pages and sitemaps.
- Checks robots.txt before fetching each page; if robots.txt cannot be fetched reliably, it fails closed and skips that host.
- Uses a minimum two-second delay between page requests to the same host.
- Limits each scheduled run to 24 pages and limits how many links it queues.
- Ignores URL query strings and common binary file extensions in this first version.
- Extracts the main page text, title and description; it does not copy full pages into the public results UI.
- Re-crawls successful URLs after around 30 days.
- Keeps search results as links to the original publishers, with short query-related snippets.

Robots.txt is a crawling signal, not a copyright licence. Respect website terms, rate limits, publisher rights and removal requests. Do not assume permission to republish text, images or other protected material. The index stores extracted text for internal matching; the public interface shows links and short snippets.

## Search and API

- / — public search interface
- /health — Worker health check
- /api/stats — number of indexed documents
- /api/search?q=your+query — public JSON search API

Search uses SQLite FTS5/BM25 relevance with stronger weighting for title matches. It is a baseline ranking model; it does not yet use a web-wide link graph, language-specific ranking or advanced spam detection.

## Free-tier constraints

Cloudflare's current D1 Free limits include a maximum 500 MB per database, 5 GB total D1 storage per account, 5 million rows read per day and 100,000 rows written per day. Workers Free has a daily request allowance. Limits and plan terms can change; monitor usage in the Cloudflare dashboard.

- D1 limits: https://developers.cloudflare.com/d1/platform/limits/
- D1 pricing and allowances: https://developers.cloudflare.com/d1/platform/pricing/
- Workers pricing: https://developers.cloudflare.com/workers/platform/pricing/

A public GitHub repository is required to use standard GitHub-hosted runners free and without a private-repository minutes allowance. The source code is public, so never store secrets in files or commits.

## Troubleshooting

- **Search page says the database is not ready:** confirm schema.sql was executed successfully in the D1 Console.
- **Worker deployment fails:** check that wrangler.jsonc contains the correct D1 Database ID and that the Worker is named openindex-search.
- **Crawler returns 401:** the INGEST_SECRET values in Cloudflare and GitHub Actions must match exactly.
- **Crawler cannot connect:** SEARCH_API_URL must be the Worker base URL, without a trailing slash.
- **No pages are indexed:** inspect the GitHub Actions log. A site may disallow automated crawling, block requests, return non-HTML or contain too little extractable text. Add other suitable seed sites.
- **A scheduled crawl does not run:** open Actions and check that the workflow is enabled. GitHub may delay scheduled workflows during busy periods.

## Project structure

- crawler/crawl.py — polite crawler and content extraction
- crawler/requirements.txt — Python dependencies
- .github/workflows/crawl.yml — scheduled and manual crawler job
- src/index.js — Worker, public search page and authenticated ingestion API
- schema.sql — D1 schema and FTS5 triggers
- seeds.txt — initial discovery URLs
- wrangler.jsonc — Worker and D1 configuration
- SETUP-CHECKLIST.md — short deployment checklist

## Licence

MIT. See LICENSE.
