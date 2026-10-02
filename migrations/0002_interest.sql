-- "Interested" marks: at most one per visitor cookie per event. A count, not a
-- rating; see docs/decisions.md.
CREATE TABLE interest (
  event_id TEXT NOT NULL,
  visitor TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (event_id, visitor)
);
