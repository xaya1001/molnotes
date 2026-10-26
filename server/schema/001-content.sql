CREATE TABLE topics (
  slug text PRIMARY KEY,
  site jsonb NOT NULL,
  content jsonb NOT NULL
);
CREATE TABLE note_directories (
  dir text PRIMARY KEY,
  metadata jsonb NOT NULL,
  compiled jsonb NOT NULL
);
CREATE TABLE notes (
  dir text NOT NULL REFERENCES note_directories(dir) ON DELETE CASCADE,
  slug text NOT NULL,
  source text NOT NULL,
  compiled jsonb NOT NULL,
  PRIMARY KEY (dir, slug)
);
CREATE TABLE assets (
  scope text NOT NULL,
  path text NOT NULL,
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  size bigint NOT NULL CHECK (size >= 0),
  content_type text NOT NULL,
  PRIMARY KEY (scope, path)
);
CREATE TABLE learning_records (
  scope text PRIMARY KEY,
  document jsonb NOT NULL
);
