CREATE TABLE content_revision (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  revision bigint NOT NULL
);
INSERT INTO content_revision(revision) VALUES (1);
CREATE FUNCTION bump_content_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE content_revision SET revision = revision + 1;
  RETURN NULL;
END $$;
CREATE TRIGGER topics_revision AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON topics
  FOR EACH STATEMENT EXECUTE FUNCTION bump_content_revision();
CREATE TRIGGER note_directories_revision AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON note_directories
  FOR EACH STATEMENT EXECUTE FUNCTION bump_content_revision();
CREATE TRIGGER notes_revision AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON notes
  FOR EACH STATEMENT EXECUTE FUNCTION bump_content_revision();
CREATE TRIGGER assets_revision AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON assets
  FOR EACH STATEMENT EXECUTE FUNCTION bump_content_revision();
