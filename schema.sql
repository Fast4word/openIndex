-- OpenIndex starter schema for Cloudflare D1.
-- documents stores metadata and extracted text. FTS5 maintains the searchable index.

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  domain TEXT NOT NULL,
  crawled_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS documents_domain_idx ON documents(domain);
CREATE INDEX IF NOT EXISTS documents_crawled_idx ON documents(crawled_at);

CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
  title,
  description,
  body,
  content='documents',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS documents_ai AFTER INSERT ON documents BEGIN
  INSERT INTO documents_fts(rowid, title, description, body)
  VALUES (new.id, new.title, new.description, new.body);
END;

CREATE TRIGGER IF NOT EXISTS documents_ad AFTER DELETE ON documents BEGIN
  INSERT INTO documents_fts(documents_fts, rowid, title, description, body)
  VALUES ('delete', old.id, old.title, old.description, old.body);
END;

CREATE TRIGGER IF NOT EXISTS documents_au AFTER UPDATE ON documents BEGIN
  INSERT INTO documents_fts(documents_fts, rowid, title, description, body)
  VALUES ('delete', old.id, old.title, old.description, old.body);
  INSERT INTO documents_fts(rowid, title, description, body)
  VALUES (new.id, new.title, new.description, new.body);
END;

CREATE TABLE IF NOT EXISTS crawl_queue (
  url TEXT PRIMARY KEY,
  domain TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  priority INTEGER NOT NULL DEFAULT 0,
  added_at INTEGER NOT NULL,
  last_crawled_at INTEGER
);

CREATE INDEX IF NOT EXISTS crawl_queue_status_idx
  ON crawl_queue(status, priority DESC, added_at);
CREATE INDEX IF NOT EXISTS crawl_queue_domain_idx
  ON crawl_queue(domain, status, added_at);
