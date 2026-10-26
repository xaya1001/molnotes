CREATE TABLE glossary (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  terms jsonb NOT NULL
);
CREATE TRIGGER glossary_revision AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON glossary
  FOR EACH STATEMENT EXECUTE FUNCTION bump_content_revision();
