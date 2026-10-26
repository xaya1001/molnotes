import { noteTerms, notesSearchIndex } from "../scripts/notes-reading.mjs";
import { buildTopicIndex, buildReviewIndex } from "../scripts/topic-index.mjs";
import { siteGroups, sortSites } from "../scripts/site-catalog.mjs";
import { chapterRoutePath, topicBasePath } from "../scripts/topic-content.mjs";

export async function publishedGlossary(client) {
  return (
    (await client.query("SELECT terms FROM glossary")).rows[0]?.terms ?? []
  );
}
/** The glossary entries a topic's chapters use, in glossary order. */
async function topicGlossary(client, content) {
  const used = new Set(content.chapters.flatMap((c) => c.terms ?? []));
  return (await publishedGlossary(client)).filter((t) => used.has(t.term));
}
/** Every term with the notes and topic chapters that use it, by term name. */
function glossaryEntries(glossary, notes, topics) {
  const uses = new Map(glossary.map((t) => [t.term, []]));
  for (const note of notes)
    for (const term of noteTerms(note.html))
      uses.get(term)?.push({
        title: note.title,
        context: note.directoryTitle,
        path: note.path,
      });
  for (const topic of topics)
    for (const chapter of topic.content.chapters)
      for (const term of chapter.terms ?? [])
        uses.get(term)?.push({
          title: chapter.title,
          context: topic.title,
          path: `${topicBasePath(topic)}${chapterRoutePath(topic.content, chapter)}`,
        });
  const collator = new Intl.Collator("zh-Hans-CN");
  return glossary
    .map((t) => ({ ...t, uses: uses.get(t.term) }))
    .sort((a, b) => collator.compare(a.term, b.term));
}

async function notebookData(client, metadata = false) {
  const directories = (
    await client.query(
      `SELECT ${metadata ? "compiled - 'html' - 'citations' - 'intro'" : "compiled"} AS compiled FROM note_directories ORDER BY (metadata->>'order')::int,dir`,
    )
  ).rows.map((r) => r.compiled);
  const notes = (
    await client.query(
      `SELECT ${metadata ? "compiled - 'html' - 'text' - 'sections' - 'molecules' - 'diagrams' - 'citations'" : "compiled"} AS compiled FROM notes WHERE NOT author`,
    )
  ).rows
    .map((r) => r.compiled)
    .sort(
      (a, b) =>
        directories.findIndex((d) => d.slug === a.directory) -
          directories.findIndex((d) => d.slug === b.directory) ||
        a.order - b.order ||
        a.slug.localeCompare(b.slug),
    );
  return { directories, notes };
}
export async function notebookIndex(client) {
  return notebookData(client, true);
}
export async function reviewIndex(client) {
  const topics = sortSites(
    (await client.query("SELECT slug, site, content FROM topics")).rows.map(
      (row) => ({ ...row.site, slug: row.slug, content: row.content }),
    ),
  );
  return buildReviewIndex(topics);
}
export async function contentIndex(client) {
  const topics = sortSites(
    (await client.query("SELECT slug, site, content FROM topics")).rows.map(
      (row) => ({ ...row.site, slug: row.slug, content: row.content }),
    ),
  );
  const glossary = await publishedGlossary(client);
  return {
    ...buildTopicIndex(topics),
    terms: glossary,
    notesSearch: notesSearchIndex(await notebookData(client)),
  };
}
export async function glossaryIndex(client) {
  const topics = (
    await client.query(`SELECT slug, site->>'title' AS title, site->>'group' AS group,
    jsonb_strip_nulls(jsonb_build_object('chapterRoute', content->'chapterRoute', 'chapters',
      (SELECT jsonb_agg(jsonb_build_object('id', ch->'id', 'title', ch->'title', 'terms', ch->'terms', 'path', ch->'path', 'number', ch->'number'))
       FROM jsonb_array_elements(content->'chapters') ch))) AS content FROM topics`)
  ).rows;
  const notes = (
    await client.query(
      "SELECT jsonb_build_object('html', compiled->>'html', 'title', compiled->>'title', 'directoryTitle', compiled->>'directoryTitle', 'path', compiled->>'path') AS compiled FROM notes WHERE NOT author",
    )
  ).rows.map((r) => r.compiled);
  return glossaryEntries(await publishedGlossary(client), notes, topics);
}
async function proseTerms(client, html) {
  const used = new Set(noteTerms(html));
  return Object.fromEntries(
    (await publishedGlossary(client))
      .filter((t) => used.has(t.term))
      .map((t) => [t.term, t]),
  );
}

/**
 * Topic metadata in catalog order, the group order of the case directory, and
 * note directories with the practice topics their notes link to.
 */
export async function contentCatalog(client) {
  const sites = sortSites(
    (
      await client.query(`SELECT slug, site,
      jsonb_strip_nulls(jsonb_build_object('chapterRoute', content->'chapterRoute', 'chapters',
        (SELECT jsonb_agg(jsonb_build_object('id', ch->'id', 'path', ch->'path', 'number', ch->'number'))
         FROM jsonb_array_elements(content->'chapters') ch))) AS content FROM topics`)
    ).rows.map(({ slug, site, content }) => ({
      ...site,
      slug,
      chapterIds: content.chapters.map((chapter) => chapter.id),
      chapterPaths: Object.fromEntries(
        content.chapters.map((chapter) => [
          chapter.id,
          chapterRoutePath(content, chapter),
        ]),
      ),
    })),
  );
  const practice = sites.filter((site) => site.group === "练习");
  const linked = new Map();
  for (const { dir, html } of (
    await client.query(
      "SELECT dir, compiled->>'html' AS html FROM notes WHERE NOT author",
    )
  ).rows) {
    const slugs = linked.get(dir) ?? new Set();
    for (const [, slug] of html.matchAll(/href="\/practice\/([a-z0-9-]+)\//g))
      slugs.add(slug);
    linked.set(dir, slugs);
  }
  const directories = (
    await client.query(
      "SELECT dir, jsonb_build_object('title', metadata->'title', 'order', metadata->'order') AS metadata FROM note_directories",
    )
  ).rows;
  return {
    groups: siteGroups,
    sites,
    directories: directories
      .map(({ dir, metadata }) => ({
        ...metadata,
        slug: dir,
        path: `/notes/${dir}/`,
        practice: practice
          .filter((site) => linked.get(dir)?.has(site.slug))
          .map((site) => site.slug),
      }))
      .sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug)),
  };
}

export async function readTopic(client, slug) {
  const row = (
    await client.query(
      "SELECT site,content,citations FROM topics WHERE slug=$1",
      [slug],
    )
  ).rows[0];
  return (
    row && {
      ...row.site,
      content: row.content,
      citations: row.citations,
      glossary: await topicGlossary(client, row.content),
    }
  );
}

export async function readNote(client, directory, slug) {
  const compiled = (
    await client.query(
      slug
        ? "SELECT compiled FROM notes WHERE dir=$1 AND slug=$2 AND NOT author"
        : "SELECT compiled FROM note_directories WHERE dir=$1",
      slug ? [directory, slug] : [directory],
    )
  ).rows[0]?.compiled;
  return (
    compiled && { ...compiled, terms: await proseTerms(client, compiled.html) }
  );
}
