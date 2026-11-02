-- Additive migration in the existing synthetic canary D1 database ONLY.
CREATE TABLE IF NOT EXISTS guided_invites (
  token_hash TEXT PRIMARY KEY, expires_ms INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS guided_sessions (
  token_hash TEXT PRIMARY KEY, run_id TEXT NOT NULL, expires_ms INTEGER NOT NULL,
  wifi_done INTEGER NOT NULL DEFAULT 0, cellular_done INTEGER NOT NULL DEFAULT 0,
  window_ms INTEGER NOT NULL DEFAULT 0, calls INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS guided_evidence (
  session_hash TEXT NOT NULL REFERENCES guided_sessions(token_hash) ON DELETE CASCADE,
  evidence_key TEXT NOT NULL, result_json TEXT NOT NULL, updated_ms INTEGER NOT NULL,
  PRIMARY KEY (session_hash, evidence_key)
);
CREATE TABLE IF NOT EXISTS guided_historical (
  source_hash TEXT NOT NULL, part INTEGER NOT NULL, content TEXT NOT NULL,
  PRIMARY KEY (source_hash, part)
);
