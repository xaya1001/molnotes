ALTER TABLE notes ADD COLUMN author boolean NOT NULL DEFAULT false;
ALTER TABLE notes DROP CONSTRAINT notes_pkey;
ALTER TABLE notes ADD PRIMARY KEY (dir, author, slug);
