-- One saved list-page filter per visitor cookie. feed_id is the public part:
-- it names the personal calendar /feed/my/<feed_id>.ics, while the visitor id
-- stays in the cookie and never appears in a URL.
CREATE TABLE prefs (
  visitor TEXT PRIMARY KEY,
  feed_id TEXT NOT NULL UNIQUE,
  filter TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
