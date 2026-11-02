-- Dedicated EMPTY canary D1 only. Never apply to either application database.
CREATE TABLE canary_runs (
  id TEXT PRIMARY KEY,
  expires_ms INTEGER NOT NULL,
  state TEXT NOT NULL
);
CREATE TABLE canary_budget (
  month TEXT PRIMARY KEY,
  grants INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE canary_metrics (
  id INTEGER PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES canary_runs(id),
  transport TEXT NOT NULL CHECK (transport IN ('relay', 'edge')),
  status INTEGER NOT NULL,
  auth_ms REAL NOT NULL,
  api_body_bytes INTEGER NOT NULL,
  media_body_bytes INTEGER NOT NULL,
  r2_reads INTEGER NOT NULL,
  cancelled INTEGER NOT NULL
);
CREATE INDEX canary_metrics_run ON canary_metrics(run_id);
