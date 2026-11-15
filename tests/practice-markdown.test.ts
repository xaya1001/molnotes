import test from "node:test";
import assert from "node:assert/strict";
import {
  compilePracticeChapter,
  readPracticeChapters,
} from "../scripts/content/practice-markdown.ts";
import { readUnit } from "../scripts/content/content-files.ts";
import { resolve } from "node:path";

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
      "prediction",
      "problem",
      "prediction",
      "prediction",
      "prediction",
      "prediction",
      "prediction",
    ],
  );
  assert.deepEqual(blocks[2], {
    type: "prediction",
    kind: "atoms",
    id: "atoms",
    question: "Compare the observations.",
    explanation: "Use the given values.",
    molecule: { name: "Sample", smiles: "[CH3][CH2][OH]" },
    answer: [2],
    labels: { 2: "oxygen" },
  });
  assert.equal(blocks[1].type === "problem" && blocks[1].answer.origin, "ai");
  assert.deepEqual(blocks[3].type === "prediction" && blocks[3].answer, [1]);
  assert.deepEqual(
    blocks[4].type === "prediction" &&
      blocks[4].kind === "atom-set" &&
      blocks[4].molecules.map((m) => m.answer),
    [[0, 2], [0]],
  );
  assert.equal(blocks[5].type === "prediction" && blocks[5].answer, 1);
  assert.equal(
    blocks[6].type === "prediction" &&
      blocks[6].kind === "number" &&
      blocks[6].tolerance,
    0.1,
  );
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
  assert.equal(topic.content.chapters[2].note, "notes/reader-test/second");
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
