CREATE TABLE subscription_sessions (
  installation_id TEXT NOT NULL REFERENCES installations(id),
  provider TEXT NOT NULL CHECK (provider IN ('chatgpt-subscription', 'grok-subscription')),
  record_json TEXT NOT NULL,
  PRIMARY KEY (installation_id, provider)
);
