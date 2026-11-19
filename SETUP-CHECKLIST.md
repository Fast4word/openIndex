# OpenIndex browser-only setup checklist

- [ ] Create a Cloudflare D1 database named `openindex-db`.
- [ ] In the D1 Console, execute all SQL from `schema.sql`.
- [ ] Copy the D1 Database ID.
- [ ] Edit `wrangler.jsonc` in GitHub and replace `REPLACE_WITH_D1_DATABASE_ID`; commit the change.
- [ ] In Cloudflare Workers & Pages, create an application from GitHub and select `Fast4word/openIndex`, branch `main`, root directory.
- [ ] Configure the deploy command as `npm run deploy` (build command: `npm install`) if Cloudflare does not detect it automatically.
- [ ] Save and deploy the Worker. Confirm the generated `workers.dev` URL opens the OpenIndex page.
- [ ] Add the Worker secret `INGEST_SECRET` in Cloudflare.
- [ ] Add GitHub Actions repository secrets `SEARCH_API_URL` (Worker base URL) and `INGEST_SECRET` (the same secret).
- [ ] Enable Actions if prompted, then manually run **Crawl and update OpenIndex**.
- [ ] Check the Actions log and `/api/stats` to confirm documents are being indexed.
- [ ] Update `CRAWLER_USER_AGENT` in `.github/workflows/crawl.yml` if you want to include a public contact address.

No Linux, local Python, local Node.js, Codespaces or terminal is required. All setup is done in the GitHub and Cloudflare web dashboards.
