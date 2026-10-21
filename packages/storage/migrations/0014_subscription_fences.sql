CREATE TABLE subscription_connections (
  installation_id TEXT NOT NULL REFERENCES installations(id),
  provider TEXT NOT NULL CHECK (provider IN ('chatgpt-subscription', 'claude-subscription', 'grok-subscription')),
  revision INTEGER NOT NULL CHECK (revision >= 0 AND revision <= 9007199254740991),
  PRIMARY KEY (installation_id, provider)
);
