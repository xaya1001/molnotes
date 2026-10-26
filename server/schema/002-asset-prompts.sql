ALTER TABLE assets ADD COLUMN prompt text CHECK (prompt <> '');
