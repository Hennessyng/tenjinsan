CREATE TABLE maintenance_gate (id INTEGER PRIMARY KEY CHECK (id = 1), phase TEXT NOT NULL CHECK (phase IN ('idle', 'draining', 'frozen', 'restoring')), token TEXT, CHECK ((phase = 'idle') = (token IS NULL)));
--> statement-breakpoint
INSERT INTO maintenance_gate (id, phase, token) VALUES (1, 'idle', NULL);
--> statement-breakpoint
CREATE TABLE maintenance_requests (token TEXT PRIMARY KEY);
