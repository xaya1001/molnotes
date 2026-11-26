import type { TestContext } from "node:test";
import { moleculeToolkit } from "../shared/molecule-toolkit.ts";
import { noteTerms, notesSearchIndex } from "../shared/notes-reading.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import {
  contentRequests,
  markdownRequests,
  inspectRequest,
} from "../scripts/content/requests.ts";
import { buildSnapshot } from "../scripts/content/content-publish.ts";
import { readUnit, type NotesUnit } from "../scripts/content/content-files.ts";
import {
  compileNotes,
  parseNote,
  noteCitations,
} from "../shared/notes-index.ts";

const head =
  "---\ntitle: Test\nsummary: Summary\ndate: 2026-10-16\norder: 0\n---\n";
const requestFence = (value: unknown) =>
  "```request\n" + stringify(value) + "```\n";

test("resource requests retain source positions and completion skills in Markdown order", async () => {
  const values = [
    {
      kind: "image",
      file: "example.png",
      caption: "Overview",
      prompt: "Draw two boxes",
    },
    {
      kind: "figure",
      caption: "Example route",
      figure: {
        kind: "scheme",
        compounds: { a: "CCO", b: "CC=O" },
        steps: [{ from: "a", to: "b" }],
      },
    },
    {
      kind: "chart",
      file: "series.svg",
      caption: "Series",
      data: [
        [0, 1],
        [1, 2],
      ],
      axes: { x: "Time", y: "Value" },
      point: "Values increase",
    },
  ];
  const body = values.map(requestFence).join("\n");
  const requests = await markdownRequests(body, "example.md", 6);
  assert.deepEqual(
    requests.map(({ kind, skill, file, line }) => ({
      kind,
      skill,
      file,
      line,
    })),
    [
      { kind: "image", skill: "note-figures", file: "example.md", line: 7 },
      {
        kind: "figure",
        skill: "chemical-figures",
        file: "example.md",
        line: 14,
      },
      { kind: "chart", skill: "note-figures", file: "example.md", line: 27 },
    ],
  );
  assert.deepEqual(
    await markdownRequests("````markdown\n" + body + "````\n", "example.md"),
    [],
  );
  assert.equal(
    (
      await markdownRequests(
        "> ~~~request\n> kind: image\n> file: example.png\n> caption: Example\n> prompt: Draw a box\n> ~~~",
        "example.md",
      )
    )[0].line,
    1,
  );
  const preview = await inspectRequest(
    requestFence(values[1]).split("\n").slice(1, -2).join("\n"),
    "example.md",
    14,
  );
  assert.equal(preview.display.meta, "路线");
});

test("resource request validation rejects invalid fields and figure inputs at the source fence", async () => {
  const image = {
    kind: "image",
    file: "example.png",
    caption: "Example",
    prompt: "Draw a box",
  };
  for (const value of [
    { ...image, kind: "unknown" },
    { ...image, prompt: undefined },
    { ...image, extra: true },
    { ...image, caption: [] },
    {
      kind: "chart",
      file: "example.svg",
      caption: "Example",
      data: null,
      axes: "Time and value",
      point: "Growth",
    },
    { kind: "figure", caption: "Example", figure: { unexpected: true } },
    {
      kind: "figure",
      caption: "Example",
      figure: { kind: "gallery", compounds: { a: "invalid-smiles" } },
    },
    {
      kind: "figure",
      caption: "Example",
      figure: {
        kind: "mechanism",
        frames: [{ id: "a", smiles: "invalid-smiles" }],
      },
    },
    {
      kind: "figure",
      caption: "Example",
      figure: {
        kind: "markush",
        core: "C[*:1]",
        groups: {
          1: {
            label: "R",
            alternatives: [
              {
                type: "repeat",
                label: "Chain",
                unit: "invalid-smiles",
                end: "C[*:2]",
                min: 1,
                max: 2,
              },
            ],
          },
        },
      },
    },
  ])
    await assert.rejects(
      markdownRequests("\n" + requestFence(value), "example.md", 6),
      /example\.md:\d+: request:/,
    );
  await assert.rejects(
    markdownRequests("```request\nkind: [\n```", "example.md"),
    /example\.md:\d+: request:/,
  );
  const source =
    "kind: figure\ncaption: Example\nfigure:\n  kind: mechanism\n  frames:\n    - id: first\n      title: First\n      smiles: invalid-smiles\n    - id: second\n      title: Second\n      smiles: invalid-smiles\n";
  const invalid = await inspectRequest(source, "example.md", 10);
  assert.deepEqual(
    invalid.errors.map(({ line, path }) => ({ line, path })),
    [
      { line: 18, path: "figure.frames[0].smiles" },
      { line: 21, path: "figure.frames[1].smiles" },
    ],
  );
  assert.equal(invalid.display.frames, undefined);
  const valid = await inspectRequest(
    source.replaceAll("invalid-smiles", "CCO"),
    "example.md",
    10,
  );
  assert.deepEqual(
    valid.display.frames?.map((frame) => [frame.title, frame.smiles]),
    [
      ["First", "CCO"],
      ["Second", "CCO"],
    ],
  );
  const syntax = await inspectRequest(
    "kind: figure\ncaption: Example\nfigure: [\n",
    "example.md",
    10,
  );
  assert.equal(syntax.errors.length, 1);
  const missing = await inspectRequest(
    source.replace("caption: Example\n", ""),
    "example.md",
    10,
  );
  assert.equal(missing.caption, "");
  assert.equal(
    missing.errors.some((error) => error.path === "caption"),
    true,
  );
});

test("todo scans reader notes and author material and build lists every pending request", async (t) => {
  const body = requestFence({
    kind: "image",
    file: "example.png",
    caption: "Example",
    prompt: "Draw a box",
  });
  const root = fixture(t, body);
  mkdirSync(join(root, "notes/demo/author"));
  writeFileSync(join(root, "notes/demo/author/plan.md"), head + body);
  const requests = await contentRequests(root);
  assert.deepEqual(
    requests.map(({ file, line }) => [file, line]),
    [
      ["notes/demo/author/plan.md", 7],
      ["notes/demo/first.md", 7],
    ],
  );
  assert.equal((await contentRequests(root, "notes/demo/first")).length, 1);
  await assert.rejects(buildSnapshot(root), (error: Error) =>
    requests.every(({ file, line }) =>
      error.message.includes(`${file}:${line}:`),
    ),
  );
  writeFileSync(join(root, "notes/demo/first.md"), head + "Completed");
  writeFileSync(join(root, "notes/demo/author/plan.md"), head + "Completed");
  assert.deepEqual(await contentRequests(root), []);
});
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
test("a chemical name compiles with its stereochemical prefix in emphasis", async (t) => {
  const root = fixture(t, "样品{(*R*)-lactate}。");
  const { notes } = await compile(root);
  assert.equal(
    notes[0].html.trim(),
    '<p>\n样品<span class="chemical-name">(<em>R</em>)-lactate</span>。</p>',
  );
});

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
    "## Section\n```timeline\ncaption: 两件事\nevents:\n  - {date: 1999-05-20, text: 获批}\n  - {between: [2000, 2004], text: 继续卖}\n```\n\n```flow\nnodes:\n  - {id: a, text: 鸦片}\n  - {id: b, text: 母液, tone: accent}\nedges: [a > b]\nsteps: [{at: a > b, title: 转移, text: 完整说明}]\n```\n\n```panels\nmode: compare\nitems:\n  - {title: 输入, text: 初始, ref: img_first}\n  - {title: 输出, text: 完成, ref: img_second}\n```",
  );
  const [note] = (await compile(root)).notes;
  assert.deepEqual(
    note.diagrams!.map(({ id, kind, caption }) => [id, kind, caption]),
    [
      ["note-diagram-0", "timeline", "两件事"],
      ["note-diagram-1", "flow", ""],
      ["note-diagram-2", "panels", ""],
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
  assert.equal(flow.flow.steps?.[0].at, "a > b");
  assert.match(note.text, /转移.*完整说明.*输入.*初始.*输出.*完成/);
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

test("molecule fences preserve declared abbreviations and reject unknown or absent groups at the source line", async (t) => {
  const body =
    "```molecule\nsmiles: CCNC(=O)OC(C)(C)C\nabbreviations: Boc\ncaption: Sample\n```";
  const root = fixture(t, body);
  const result = await compile(root);
  assert.deepEqual(result.notes[0].molecules[0].molecules[0].abbreviations, [
    "Boc",
  ]);
  for (const name of ["Unknown", "Ts"]) {
    writeFileSync(
      join(root, "notes/demo/first.md"),
      head + body.replace("abbreviations: Boc", `abbreviations: ${name}`),
    );
    await assert.rejects(
      compile(root),
      /notes\/demo\/first.md:\d+:.*(?:whitelist|SMILES)/,
    );
  }
});

test("library fences preserve references, local numbering and searchable captions", async (t) => {
  const root = fixture(
    t,
    '## Section\n```figure-ref\nref: cmp_example\nnumbers:\n  compound: "4"\ncaption: A shared structure\n```',
  );
  const result = await compile(root);
  const figure = result.notes[0].diagrams?.[0];
  assert.equal(figure?.kind, "library");
  if (figure?.kind !== "library") throw new Error("Missing library figure");
  assert.deepEqual(figure.reference, {
    ref: "cmp_example",
    numbers: { compound: "4" },
    caption: "A shared structure",
  });
  assert.match(result.notes[0].html, /note-diagram-0/);
  const invalid = fixture(
    t,
    "## Section\n```figure-ref\nref: cmp_example\nsmiles: CC\n```",
  );
  await assert.rejects(compile(invalid), /unknown reference field smiles/);
});

test("energy fences compile with searchable labels and fence-line diagnostics", async (t) => {
  const root = fixture(
    t,
    "## Plot\n\n```energy\npoints: [0 A, 90 TS1, -25 B]\nmarks: [{from: A, to: B}]\ncaption: Sample path\n```",
  );
  const [note] = (await compile(root)).notes;
  assert.equal(note.diagrams![0].kind, "energy");
  assert.match(note.html, /class="note-diagram"/);
  assert.match(note.text, /Sample path.*A.*TS1.*B.*ΔG°/);
  writeFileSync(
    join(root, "notes/demo/first.md"),
    head + "## Plot\n\n```energy\npoints: [0 A, 90 TS1]\n```",
  );
  await assert.rejects(
    compile(root),
    new RegExp(`notes/demo/first\\.md:${head.split("\n").length + 2}: 路径`),
  );
});

test("note callouts render both types with inline content, lists and ordinary quotes", async (t) => {
  const root = fixture(
    t,
    "> [!要点] **Conclusion**\n> Use [[Term]] and $x^2$.\n>\n> - First\n> - Second\n>\n> Final paragraph.\n\n> [!易错]\n> Compare observations.\n\n> Ordinary quote.",
  );
  const [note] = (await compile(root)).notes;
  assert.match(note.html, /<aside class="callout note-callout" role="note">/);
  assert.match(
    note.html,
    /<span class="callout-kind">要点<\/span><strong>Conclusion<\/strong>/,
  );
  assert.match(note.html, /<ul>/);
  assert.match(note.html, /class="term"/);
  assert.match(note.html, /class="katex"/);
  assert.match(note.html, /<p>\s*Final paragraph\.<\/p>/);
  assert.match(note.html, /callout--caution/);
  assert.match(note.html, /<blockquote>\n<p>\s*Ordinary quote\.<\/p>/);
  assert.doesNotMatch(note.text, /\[!要点\]/);
});
for (const body of [
  "> [!提示]\n> Body",
  "> [!要点]\n> ## Heading",
  "> [!要点]\n> ![image](assets/a.svg)",
  "> [!要点]\n> > [!易错]\n> > Body",
  "> [!要点]\n> | A | B |\n> | --- | --- |\n> | 1 | 2 |",
])
  test(`reject unsupported callout content ${body.split("\n")[0]}`, async (t) => {
    const root = fixture(t, body);
    await assert.rejects(compile(root), /notes\/demo\/first\.md:\d+: 提示块/);
  });
