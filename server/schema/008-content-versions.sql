-- The current version of every unit, including a removed one: its row then
-- describes the removal, and a later push continues the numbering.
CREATE TABLE content_units (
  unit text PRIMARY KEY CHECK (unit ~ '^(notes|sites)/[a-z0-9]+(-[a-z0-9]+)*$'),
  version integer NOT NULL CHECK (version >= 1),
  pushed_at timestamptz NOT NULL DEFAULT now(),
  pushed_by text CHECK (pushed_by <> ''),
  message text NOT NULL DEFAULT ''
);
-- Units published before versions were kept start at version 1 with no pusher.
INSERT INTO content_units(unit, version)
SELECT 'sites/' || slug, 1 FROM topics
UNION ALL
SELECT 'notes/' || dir, 1 FROM note_directories;
-- Replaced and removed versions: everything a pull needs to export them again.
CREATE TABLE content_versions (
  unit text NOT NULL,
  version integer NOT NULL,
  pushed_at timestamptz NOT NULL,
  pushed_by text,
  message text NOT NULL,
  files jsonb NOT NULL,
  assets jsonb NOT NULL,
  PRIMARY KEY (unit, version)
);
