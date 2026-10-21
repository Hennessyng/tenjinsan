CREATE TABLE setup_scheduling (
  grant_id TEXT PRIMARY KEY NOT NULL REFERENCES transmission_grants(id),
  failure_code TEXT
);
