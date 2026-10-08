-- Static office configuration.
PRAGMA foreign_keys = ON;

-- Service types offered by the office.
CREATE TABLE IF NOT EXISTS services (
  tag TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  service_time INTEGER NOT NULL CHECK (service_time > 0)
);

-- Physical counters and their many-to-many service assignments.
CREATE TABLE IF NOT EXISTS counters (
  id INTEGER PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS counter_services (
  counter_id INTEGER NOT NULL REFERENCES counters(id) ON DELETE CASCADE,
  service_tag TEXT NOT NULL REFERENCES services(tag) ON DELETE CASCADE,
  PRIMARY KEY (counter_id, service_tag)
);

-- Ticket history. Waiting tickets are operational; called/served/expired rows
-- remain available for future statistics.
CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  service_tag TEXT NOT NULL REFERENCES services(tag),
  sequence_number INTEGER NOT NULL CHECK (sequence_number > 0),
  issued_at TEXT,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'called', 'served', 'expired')),
  counter_id INTEGER REFERENCES counters(id),
  called_at TEXT,
  served_at TEXT,
  queue_day TEXT NOT NULL,
  UNIQUE (service_tag, queue_day, sequence_number)
);

-- Indexes for FIFO queue reads and statistics queries.
CREATE INDEX IF NOT EXISTS tickets_waiting_by_service
  ON tickets (service_tag, status, id);

CREATE INDEX IF NOT EXISTS tickets_statistics
  ON tickets (service_tag, status, issued_at);