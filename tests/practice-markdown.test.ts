import test from "node:test";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import {
  compilePracticeChapter,
  readPracticeChapters,
} from "../scripts/content/practice-markdown.ts";
import { readUnit } from "../scripts/content/content-files.ts";
import { join, resolve } from "node:path";
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import {
  contentRequests,
  inspectRequest,
} from "../scripts/content/requests.ts";
import { buildSnapshot } from "../scripts/content/content-publish.ts";

test("single chapter check and publication report the same chapter error", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "practice-check-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const fixture = resolve("tests/fixtures/content");
  for (const entry of ["glossary.json", "notes/reader-test", "sites/sample"])
    cpSync(join(fixture, entry), join(root, entry), { recursive: true });
  const path = join(root, "sites/sample/content.json");
  const content = JSON.parse(readFileSync(path, "utf8"));
  const [chapter, ...rest] = content.chapters;
  for (const change of [
    { blocks: [{ type: "quiz", questions: ["missing"] }] },
    { blocks: [{ type: "table", columns: ["Value"], rows: [["1"]] }] },
    { refs: ["missing"] },
    { terms: ["missing"] },
    {
      blocks: [
        {
          type: "callout",
          text: "Sample",
          link: { to: "/missing", text: "Link" },
        },
      ],
    },
  ]) {
    content.chapters = [{ ...chapter, ...change }, ...rest];
    writeFileSync(path, JSON.stringify(content));
    const check = spawnSync(
      process.execPath,
      ["scripts/content.ts", "check", "sites/sample/content.json#start"],
      {
        encoding: "utf8",
        env: { ...process.env, MOLNOTES_CONTENT_DIR: root },
      },
    );
    assert.equal(check.status, 1);
    await assert.rejects(buildSnapshot(root), (error: Error) => {
      assert.equal(error.message, check.stderr.trim());
      return true;
    });
  }
});

test("practice requests share validation, preview positions, todo and the snapshot gate", async (t) => {
  const source = chapter(
    "```request\nkind: image\nfile: sample.png\ncaption: Neutral observation\nprompt: Draw two boxes.\n```\n\nContinue the observation.",
  );
  await assert.rejects(
    compilePracticeChapter(source, file),
    /check\.md:12: Unresolved image request/,
  );
  const requests: { file: string; line: number; kind: string }[] = [];
  const compiled = await compilePracticeChapter(
    source,
    file,
    new Map(),
    async (body, file, line) => {
      requests.push(await inspectRequest(body, file, line));
    },
  );
  assert.equal(compiled.blocks.at(-1)?.type, "paragraph");
  assert.deepEqual(
    requests.map(({ file, line, kind }) => ({ file, line, kind })),
    [{ file, line: 12, kind: "image" }],
  );
  const root = mkdtempSync(join(tmpdir(), "practice-requests-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "sites/practice/chapters"), { recursive: true });
  writeFileSync(join(root, file), source);
  writeFileSync(
    join(root, "sites/practice/content.json"),
    JSON.stringify({ chapters: ["chapters/check.md"] }),
  );
  assert.deepEqual(
    await contentRequests(root, "sites/practice"),
    await contentRequests(root),
  );
  assert.equal((await contentRequests(root))[0].caption, "Neutral observation");
  await assert.rejects(
    buildSnapshot(root),
    /sites\/practice\/chapters\/check\.md:12: unresolved image request/,
  );
});

const file = "sites/practice/chapters/check.md";
const chapter = (questions: string) => `---
title: Neutral observations
note: notes/reader-test/second
number: 3
refs: []
---

## Compare

Read the observation.

${questions}`;
const fence = (yaml: string) => `\`\`\`question\n${yaml}\n\`\`\``;
const prediction = (type: string, fields: string) =>
  `type: ${type}\nid: ${type}\nquestion: Compare the observations.\nexplanation: Use the given values.\n${fields}`;

test("practice figure references compile to existing topic blocks", async () => {
  const reference = {
    ref: "img_example",
    caption: "Neutral observation",
    alt: "Two samples",
    presentation: "figure",
  };
  const result = await compilePracticeChapter(
    chapter("```figure-ref\n" + JSON.stringify(reference) + "\n```"),
    file,
  );
  assert.deepEqual(result.blocks.at(-1), { ...reference, type: "figure-ref" });
});

test("each question type compiles to the existing block and answer contract", async () => {
  const result = await compilePracticeChapter(
    chapter(
      [
        prediction(
          "choice",
          "options: [A, B]\nanswer: 0\noptionExplanations: [Two, One]",
        ),
        "type: problem\nid: open\nlang: en\nprompt: Compare A and B.\nparts: [Count the difference.]\nanswer: {text: One, origin: ai, basis: Given counts}",
        prediction(
          "atoms",
          "molecule: {name: Sample, smiles: '[CH3:30][CH2:10][OH:20]'}\nanswer: [20]\nlabels: {20: oxygen}",
        ),
        prediction(
          "bonds",
          "molecule: {name: Sample, smiles: '[CH3:30][CH2:10][OH:20]'}\nanswer: [[20, 10]]",
        ),
        prediction(
          "atom-set",
          "molecules:\n  - {name: Sample, smiles: '[CH3:30][CH2:10][OH:20]', answer: [30, 20]}\n  - {name: Sample, smiles: '[OH:3][CH3:9]', answer: [3]}",
        ),
        prediction("ranking", "options: [A, B, C]\nanswer: 1"),
        prediction(
          "number",
          "input: {label: Count, unit: objects}\nanswer: 2\ntolerance: 0.1",
        ),
      ]
        .map(fence)
        .join("\n\n"),
    ),
    file,
  );
  assert.equal(result.id, "check");
  assert.deepEqual(result.blocks.slice(0, 2), [
    { type: "heading", level: 2, text: "Compare" },
    { type: "paragraph", text: "Read the observation." },
  ]);
  const blocks = result.blocks.slice(2);
  assert.deepEqual(
    blocks.map((b) => b.type),
    [
      "choice",
      "problem",
      "structure",
      "structure",
      "structure",
      "ranking",
      "number",
    ],
  );
  assert.deepEqual(blocks[2], {
    type: "structure",
    kind: "atoms",
    id: "atoms",
    question: "Compare the observations.",
    explanation: "Use the given values.",
    molecule: { name: "Sample", smiles: "[CH3][CH2][OH]" },
    answer: [2],
    labels: { 2: "oxygen" },
  });
  assert.equal(blocks[1].type === "problem" && blocks[1].answer.origin, "ai");
  assert.deepEqual(
    blocks[3].type === "structure" &&
      blocks[3].kind === "bonds" &&
      blocks[3].answer,
    [1],
  );
  assert.deepEqual(
    blocks[4].type === "structure" &&
      blocks[4].kind === "atom-set" &&
      blocks[4].molecules.map((m) => m.answer),
    [[0, 2], [0]],
  );
  assert.equal(blocks[5].type === "ranking" && blocks[5].answer, 1);
  assert.equal(blocks[6].type === "number" && blocks[6].tolerance, 0.1);
});

test("stable ids and mapped answers report their source locations", async () => {
  const fields = "options: [A, B]\nanswer: 0\noptionExplanations: [Two, One]";
  const choice = prediction("choice", fields);
  const cases: [string, RegExp][] = [
    [
      fence(choice.replace("id: choice\n", "")),
      /check\.md:12: question needs a stable id/,
    ],
    [
      [fence(choice), fence(choice)].join("\n\n"),
      /check\.md:\d+: Duplicate question id choice; first used at .*check\.md:12/,
    ],
    [
      fence(
        prediction(
          "atoms",
          "molecule: {name: Sample, smiles: '[CH3:1][OH:1]'}\nanswer: [1]",
        ),
      ),
      /check\.md:12: Duplicate atom mapping number 1/,
    ],
    [
      fence(
        prediction(
          "atoms",
          "molecule: {name: Sample, smiles: '[CH3:1][OH:2]'}\nanswer: [9]",
        ),
      ),
      /check\.md:12: Unknown atom mapping number 9/,
    ],
    [
      fence(
        prediction(
          "bonds",
          "molecule: {name: Sample, smiles: '[CH3:1][CH2:2][OH:3]'}\nanswer: [[1, 3]]",
        ),
      ),
      /No bond between mapping numbers 1, 3/,
    ],
  ];
  for (const [source, error] of cases)
    await assert.rejects(compilePracticeChapter(chapter(source), file), error);
  const ids = new Map<string, string>();
  await compilePracticeChapter(chapter(fence(choice)), file, ids);
  await assert.rejects(
    compilePracticeChapter(
      chapter(fence(choice)),
      "sites/practice/chapters/other.md",
      ids,
    ),
    /other\.md:12: Duplicate question id choice/,
  );
});

test("Markdown and JSON chapters keep their authored order in one topic", async () => {
  const topic = await readUnit(
    resolve("tests/fixtures/content"),
    "sites/sample",
  );
  assert.equal(topic.kind, "sites");
  if (topic.kind !== "sites") return;
  assert.deepEqual(
    topic.content.chapters.map((c) => c.id),
    ["start", "next", "written"],
  );
  assert.deepEqual(topic.content.chapters[2].note, {
    href: "/notes/reader-test/second",
    title: "第二篇观察",
  });
  const authored = {
    chapters: [topic.content.chapters[2], "chapters/written.md"],
  };
  await assert.rejects(
    readPracticeChapters(
      resolve("tests/fixtures/content"),
      "sites/sample",
      authored,
      "练习",
    ),
    /written\.md:\d+: Duplicate question id written-choice/,
  );
});

test("publication compiles the same exercise prose in JSON and Markdown", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "practice-format-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const unit = "sites/sample";
  cpSync(resolve("tests/fixtures/content", unit), join(root, unit), {
    recursive: true,
  });
  cpSync(resolve("tests/fixtures/content/notes"), join(root, "notes"), {
    recursive: true,
  });
  const path = join(root, unit, "content.json");
  const content = JSON.parse(readFileSync(path, "utf8"));
  const fields = {
    question: "Compare {Sample} with $x_1$ and σ*.",
    options: ["*First*", "Second"],
    explanation: "**Check** the difference.",
    optionExplanations: ["$x_1$ is larger.", "The \\* is literal."],
  };
  const problem = {
    id: "formatted-open",
    lang: "en",
    prompt: "Measure {Sample}.\n\n- Write **units**.",
    parts: ["Use $x_1$.\n\n* Explain your setup."],
    answer: {
      text: ["*Compare* the two.", "3. Record $x_1$.\n   - Add {Sample}."],
      origin: "ai",
      basis: "Sample counts",
    },
  };
  content.chapters[0].blocks.push({ ...problem, type: "problem" });
  Object.assign(content.chapters[0].blocks[1], fields, {
    id: "formatted-choice",
  });
  Object.assign(content.quiz[0], fields);
  Object.assign(content.placement[0], fields);
  writeFileSync(path, JSON.stringify(content));
  const writtenPath = join(root, unit, "chapters/written.md");
  const written = readFileSync(writtenPath, "utf8");
  writeFileSync(
    writtenPath,
    chapter(
      [
        fence(
          JSON.stringify({
            ...fields,
            id: "markdown-choice",
            type: "choice",
            answer: 0,
          }),
        ),
        fence(
          JSON.stringify({ ...problem, id: "markdown-open", type: "problem" }),
        ),
      ].join("\n\n"),
    ),
  );
  const topic = await readUnit(root, unit);
  assert.equal(topic.kind, "sites");
  const [json, , markdown] = topic.content.chapters;
  const expected = {
    question: [
      "Compare ",
      { style: "chemical-name", parts: ["Sample"] },
      " with ",
      { style: "math", tex: "x_1" },
      " and σ*.",
    ],
    options: [[{ style: "em", parts: ["First"] }], null],
    explanation: [{ style: "strong", parts: ["Check"] }, " the difference."],
    optionExplanations: [
      [{ style: "math", tex: "x_1" }, " is larger."],
      ["The * is literal."],
    ],
  };
  for (const exercise of [
    json.blocks.find((block) => block.type === "choice"),
    markdown.blocks.find((block) => block.type === "choice"),
    topic.content.quiz?.[0],
    topic.content.placement?.[0],
  ])
    assert.deepEqual(exercise?.prose, expected);

  const para = (...parts: import("../shared/prose-format.ts").ProsePart[]) => ({
    type: "paragraph",
    parts,
  });
  const expectedProblem = {
    prompt: [
      para("Measure ", { style: "chemical-name", parts: ["Sample"] }, "."),
      {
        type: "list",
        ordered: false,
        items: [[para("Write ", { style: "strong", parts: ["units"] }, ".")]],
      },
    ],
    parts: [
      [
        para("Use ", { style: "math", tex: "x_1" }, "."),
        {
          type: "list",
          ordered: false,
          items: [[para("Explain your setup.")]],
        },
      ],
    ],
    answer: [
      para({ style: "em", parts: ["Compare"] }, " the two."),
      {
        type: "list",
        ordered: true,
        start: 3,
        items: [
          [
            para("Record ", { style: "math", tex: "x_1" }, "."),
            {
              type: "list",
              ordered: false,
              items: [
                [
                  para(
                    "Add ",
                    { style: "chemical-name", parts: ["Sample"] },
                    ".",
                  ),
                ],
              ],
            },
          ],
        ],
      },
    ],
  };
  for (const chapter of [json, markdown]) {
    const exercise = chapter.blocks.find((block) => block.type === "problem");
    assert.deepEqual(exercise?.prose, expectedProblem);
  }

  content.quiz[0].options = ["*First", "Second"];
  writeFileSync(path, JSON.stringify(content));
  await assert.rejects(
    buildSnapshot(root),
    /sites\/sample\/content\.json: question .* options\[0\]: Unparsed formatting marker \*/,
  );
  content.quiz[0].options = fields.options;
  writeFileSync(path, JSON.stringify(content));
  writeFileSync(
    writtenPath,
    written.replace("A 比 B 多一个。", "A 比 {Sample 多一个。"),
  );
  await assert.rejects(
    buildSnapshot(root),
    /sites\/sample\/content\.json: chapter written question written-open answer\.text: Unparsed formatting marker \{/,
  );
  writeFileSync(
    writtenPath,
    written.replace("A 比 B 多一个。", "A 比 $x_1 多一个。"),
  );
  await assert.rejects(
    buildSnapshot(root),
    /question written-open answer\.text: Unparsed formatting marker \$/,
  );
});

test("practice chapter checks referenced note headings and explanations", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "practice-lint-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "sites/practice/chapters"), { recursive: true });
  mkdirSync(join(root, "notes/reader-test"), { recursive: true });
  writeFileSync(
    join(root, "notes/reader-test/second.md"),
    "---\ntitle: Sample\nsummary: Sample\ndate: 2026-01-01\norder: 1\n---\n\n## Existing\n",
  );
  const run = async (q: string) => {
    writeFileSync(join(root, file), chapter(fence(q)));
    await readPracticeChapters(
      root,
      "sites/practice",
      { chapters: ["chapters/check.md"] },
      "练习",
    );
  };
  const q = prediction(
    "choice",
    "options: [A, B]\nanswer: 0\noptionExplanations: [A, B]",
  );
  await assert.rejects(
    run(q + "\nsource: 依据笔记「Missing」"),
    /question choice: unknown note section Missing/,
  );
  await assert.rejects(
    run(q.replace("Use the given values.", "映射号")),
    /forbidden explanation term/,
  );
});

test("check accepts a Markdown chapter and a JSON chapter selector", (t) => {
  const root = mkdtempSync(join(tmpdir(), "practice-cli-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "glossary.json"), "[]");
  mkdirSync(join(root, "sites/practice/chapters"), { recursive: true });
  mkdirSync(join(root, "notes/reader-test"), { recursive: true });
  writeFileSync(
    join(root, "notes/reader-test/second.md"),
    "---\ntitle: Sample\nsummary: Sample\ndate: 2026-01-01\norder: 1\n---\n\n## Existing\n",
  );
  writeFileSync(join(root, file), chapter(""));
  writeFileSync(
    join(root, "sites/practice/site.json"),
    JSON.stringify({
      group: "练习",
      title: "Practice",
      description: "Sample",
      order: 1,
    }),
  );
  writeFileSync(
    join(root, "sites/practice/content.json"),
    JSON.stringify({
      chapters: [
        "chapters/check.md",
        {
          id: "json",
          title: "JSON",
          refs: [],
          note: "notes/reader-test/second",
          blocks: [],
        },
      ],
    }),
  );
  for (const target of [
    "content/sites/practice/chapters/check.md",
    "sites/practice/content.json#json",
  ]) {
    const result = spawnSync(
      process.execPath,
      ["scripts/content.ts", "check", target],
      { encoding: "utf8", env: { ...process.env, MOLNOTES_CONTENT_DIR: root } },
    );
    assert.equal(result.status, 0, result.stderr);
  }
});
