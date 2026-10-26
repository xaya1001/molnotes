-- Content history lives in the local content repository; the database keeps
-- only the commit each unit was last published or removed from.
DROP TABLE IF EXISTS content_versions;
ALTER TABLE content_units
  DROP COLUMN IF EXISTS version,
  DROP COLUMN IF EXISTS message,
  ADD COLUMN IF NOT EXISTS git_commit text CHECK (git_commit ~ '^[0-9a-f]{40}([0-9a-f]{24})?$');
