CREATE TABLE maintenance_instances (id TEXT PRIMARY KEY, role TEXT NOT NULL CHECK (role IN ('api', 'worker', 'auth', 'storage', 'operator')));
