import type { TestContext } from "node:test";
import { moleculeToolkit } from "../shared/molecule-toolkit.ts";
import { noteTerms, notesSearchIndex } from "../shared/notes-reading.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readUnit, type NotesUnit } from "../scripts/content/content-files.ts";
import {
  compileNotes,
  parseNote,
  noteCitations,
} from "../shared/notes-index.ts";

const head =
  "---\ntitle: Test\nsummary: Summary\ndate: 2026-10-16\norder: 0\n---\n";
function fixture(t: TestContext, body = "## Section\nText") {
  const root = mkdtempSync(join(tmpdir(), "notes-index-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "notes/demo"), { recursive: true });
  writeFileSync(
    join(root, "notes/demo/directory.json"),
    JSON.stringify({ title: "Demo", intro: "Intro", order: 1 }),
  );
  writeFileSync(join(root, "notes/demo/first.md"), head + body);
  return root;
}
async function compile(root: string, assetExists = () => false) {
  const unit = (await readUnit(root, "notes/demo")) as NotesUnit;
  const directory = { ...unit.metadata, slug: "demo", path: "/notes/demo/" };
  const notes = unit.notes.map(({ slug, source }) => ({
    ...parseNote(source, `notes/demo/${slug}.md`),
    slug,
    directory: "demo",
    directoryTitle: "Demo",
    path: `/notes/demo/${slug}`,
    file: `notes/demo/${slug}.md`,
  }));
  return compileNotes({
    directories: [directory],
    notes,
    terms: {
      Term: {
        term: "Term",
        full: "Full",
        definition: "Definition",
        confusion: "Confusion",
      },
      "A&B": {
        term: "A&B",
        full: "Full",
        definition: "Definition",
        confusion: "Confusion",
      },
    },
    routes: new Set([
      "/notes/demo/",
      "/sites/topic/chapters/1",
      ...notes.map((n) => n.path),
    ]),
    assetExists,
  });
}
test("front matter rejects missing, malformed, unknown, duplicate and invalid fields", () => {
  for (const source of [
    "Text",
    head.replace("title: Test\n", ""),
    head.replace("order: 0", "order: nope"),
    head.replace("date: 2026-10-16", "date: 2026-02-30"),
    head.replace("summary: Summary", "summary: [bad]"),
    head.replace("order: 0", "order: 0\nextra: x"),
    head.replace("order: 0", "order: 0\norder: 1"),
    head.replace("title: Test", "title: [broken"),
  ])
    assert.throws(() => parseNote(source, "test.md"), /test.md:\d+:/);
});
for (const [label, body, pattern] of [
  ["h1", "# Bad", /headings/],
  ["term", "[[Missing]]", /Unknown term/],
  ["note link", "[bad](missing)", /Unknown internal link/],
  ["chapter link", "[bad](/sites/demo/chapters/99)", /Unknown internal link/],
  ["image", "![bad](assets/missing.png)", /Missing image/],
  ["image traversal", "![bad](../private.png)", /Images must/],
  [
    "smiles",
    "```molecule\nsmiles: not-a-molecule\ncaption: bad\n```",
    /Invalid SMILES/,
  ],
  ["molecule pair", "```molecule\nsmiles: CC\n```", /Missing caption/],
  [
    "timeline date",
    "```timeline\nevents:\n  - {date: 1968-13, text: x}\n```",
    /:\d+: timeline lane 1 event 1 date has no month 13/,
  ],
  ["flow yaml", "```flow\nnodes: [\n```", /:\d+: flow:/],
] satisfies [string, string, RegExp][])
  test(`reject ${label} with location`, async (t) => {
    const root = fixture(t, body);
    await assert.rejects(compile(root), pattern);
  });
test("directory metadata is mandatory and slugs are validated", async (t) => {
  const root = fixture(t);
  rmSync(join(root, "notes/demo/directory.json"));
  await assert.rejects(compile(root), /ENOENT/);
  writeFileSync(
    join(root, "notes/demo/directory.json"),
    '{"title":"Demo","intro":"intro","order":0}',
  );
  await assert.rejects(compile(root), /invalid directory/);
  writeFileSync(
    join(root, "notes/demo/directory.json"),
    '{"title":"Demo","intro":"intro","order":1}',
  );
  writeFileSync(join(root, "notes/demo/Bad.md"), head);
  await assert.rejects(compile(root), /invalid slug/);
});
test("author material follows the note contract under author/", async (t) => {
  const root = fixture(t);
  const author = join(root, "notes/demo/author");
  mkdirSync(author);
  writeFileSync(join(author, "plan.md"), head + "## Plan");
  assert.deepEqual(
    ((await readUnit(root, "notes/demo")) as NotesUnit).notes.map(
      ({ slug, author }) => [slug, author],
    ),
    [
      ["first", false],
      ["plan", true],
    ],
  );
  writeFileSync(join(author, "draft.md"), "## No front matter");
  await assert.rejects(
    readUnit(root, "notes/demo"),
    /notes\/demo\/author\/draft\.md:1: Missing YAML front matter/,
  );
  rmSync(join(author, "draft.md"));
  writeFileSync(join(author, "Bad.md"), head);
  await assert.rejects(
    readUnit(root, "notes/demo"),
    /notes\/demo\/author\/Bad\.md: invalid slug/,
  );
  rmSync(join(author, "Bad.md"));
  for (const entry of ["notes.txt", "assets/"]) {
    if (entry.endsWith("/")) mkdirSync(join(author, entry));
    else writeFileSync(join(author, entry), "text");
    await assert.rejects(
      readUnit(root, "notes/demo"),
      /author material must be <slug>\.md files/,
    );
    rmSync(join(author, entry), { recursive: true });
  }
});
test("render headings, molecules, glossary, links, escaped HTML, table and formulas", async (t) => {
  const root = fixture(
    t,
    "## Section\n[[Term]] [[A&B]] [[Term]] [next](second) [chapter](/sites/topic/chapters/1)\n\n<script>alert(1)</script>\n\n$K_d$\n\n$$\nx^2\n$$\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```molecule\nsmiles: CC\ncaption: ethane\nsmiles: CCC\ncaption: propane\n```\n\n## 资料来源\nBook",
  );
  writeFileSync(join(root, "notes/demo/second.md"), head + "## Second");
  const result = await compile(root);
  const note = result.notes[0];
  assert.deepEqual(noteTerms(note.html), ["Term", "A&B"]);
  assert.match(note.html, /href="\/notes\/demo\/second"/);
  assert.match(note.html, /&lt;script&gt;/);
  assert.match(note.html, /class="katex/);
  assert.match(note.html, /<table>/);
  assert.match(note.html, /<details class="note-sources">/);
  assert.equal(note.molecules[0].molecules.length, 2);
  assert.equal(note.sections.length, 2);
  assert.match(note.text, /Term A&B Term next chapter/);
  const search = notesSearchIndex(result);
  assert.deepEqual(Object.keys(search.notes[0]).sort(), [
    "directoryTitle",
    "path",
    "summary",
    "text",
    "title",
  ]);
  assert.deepEqual(Object.keys(search.directories[0]).sort(), [
    "path",
    "summary",
    "title",
  ]);
  assert.equal(search.notes[0].text, note.text);
});
test("timeline and flow fences become figures their text is searchable in", async (t) => {
  const root = fixture(
    t,
    "## Section\n```timeline\ncaption: 两件事\nevents:\n  - {date: 1999-05-20, text: 获批}\n  - {between: [2000, 2004], text: 继续卖}\n```\n\n```flow\nnodes:\n  - {id: a, text: 鸦片}\n  - {id: b, text: 母液, tone: accent}\nedges: [a > b]\n```",
  );
  const [note] = (await compile(root)).notes;
  assert.deepEqual(
    note.diagrams!.map(({ id, kind, caption }) => [id, kind, caption]),
    [
      ["note-diagram-0", "timeline", "两件事"],
      ["note-diagram-1", "flow", ""],
    ],
  );
  assert.match(note.html, /<div id="note-diagram-0" class="note-diagram">/);
  const timeline = note.diagrams![0];
  assert.ok(timeline.kind === "timeline");
  const [approved, kept] = timeline.timeline.lanes[0].events;
  // A full date stays text in YAML and lands inside its year.
  assert.equal(approved.show, "1999 年 5 月 20 日");
  assert.ok(approved.at > 1999.38 && approved.at < 1999.39);
  assert.deepEqual([kept.at, kept.undated, kept.show], [2002, true, ""]);
  const flow = note.diagrams![1];
  assert.ok(flow.kind === "flow");
  assert.equal(flow.flow.nodes[1].tone, "accent");
  assert.match(note.text, /两件事.*获批.*继续卖.*鸦片 母液/);
});
test("an image shows its description as a caption under it", async (t) => {
  const root = fixture(
    t,
    "## Section\n![图 1　<b>two</b> rings](assets/a.png)\n\n![](assets/b.png)",
  );
  const [note] = (await compile(root, () => true)).notes;
  const captions = [
    ...note.html.matchAll(
      /<\/button><span class="note-caption">([^<]*)<\/span>/g,
    ),
  ].map((match) => match[1]);
  assert.deepEqual(captions, ["图 1　&lt;b&gt;two&lt;/b&gt; rings"]);
  assert.equal((note.html.match(/class="note-image"/g) ?? []).length, 2);
});
test("inline formulas keep subscripts when Prettier escapes underscores inside bold", async (t) => {
  const root = fixture(
    t,
    "## Section\n**浓度等于 $K\\_\\text{d}$ 时**占有一半",
  );
  const { notes } = await compile(root);
  assert.match(notes[0].html, /msupsub/);
  assert.doesNotMatch(notes[0].html, /<span class="mord">_<\/span>/);
});

test("bold closes after CJK punctuation followed by text", async (t) => {
  const root = fixture(
    t,
    "## Section\n**专利保护的是那个染料。**这一幕的办法能找到药，“**引号里**”也加粗。",
  );
  const { notes } = await compile(root);
  assert.match(notes[0].html, /<strong>专利保护的是那个染料。<\/strong>这一幕/);
  assert.match(notes[0].html, /“<strong>引号里<\/strong>”/);
  assert.doesNotMatch(notes[0].html, /\*\*/);
});

test("citation scans keep reference definitions and source locations local to each document", () => {
  assert.deepEqual(
    noteCitations("[one][paper]\n\n[paper]: src:sample", "first.md", 7),
    [{ href: "src:sample", where: "first.md:8" }],
  );
  assert.deepEqual(noteCitations("[two][paper]", "second.md"), []);
  assert.deepEqual(
    noteCitations(
      "[two](src:other)\n\n```\n[code](src:ignored)\n```",
      "second.md",
      3,
    ),
    [{ href: "src:other", where: "second.md:4" }],
  );
});

test("publication compilers share one molecule toolkit across overlapping callers", async () => {
  const [first, second] = await Promise.all([
    moleculeToolkit(),
    moleculeToolkit(),
  ]);
  assert.equal(first, second);
  assert.equal(await moleculeToolkit(), first);
});
