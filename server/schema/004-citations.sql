ALTER TABLE topics ADD COLUMN citations jsonb NOT NULL DEFAULT '{}';
ALTER TABLE note_directories ADD COLUMN citations jsonb NOT NULL DEFAULT '{}';
CREATE TABLE source_registry (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  registry jsonb NOT NULL
);
