type RawBlock = { type: string; [field: string]: unknown };
type FixtureChapter = {
  id: string;
  number?: number;
  title: string;
  refs: (string | number)[];
  excerpts?: string[];
  blocks: RawBlock[];
  path?: string;
};
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  blockSearchText,
  chapterExercises,
  chapterRoutePath,
  validateTopicContent,
} from "../shared/topic-content.ts";

// Content fixtures are plain JSON that the tests change freely, valid or not.
function content(overrides = {}) {
  const value = {
    parts: [{ title: "一", chapters: ["a"] }],
    chapters: [
      {
        id: "a",
        number: 1,
        title: "章",
        refs: [1],
        excerpts: ["e1"],
        blocks: [
          { type: "heading", text: "正文" },
          { type: "paragraph", text: "一段" },
          {
            type: "choice",
            id: "a",
            question: "哪个？",
            options: ["x", "y"],
            answer: 1,
            explanation: "因为 y",
          },
          { type: "heading", text: "揭晓" },
          { type: "paragraph", text: "结论" },
        ],
      },
    ],
    excerpts: [{ id: "e1", source: 1, locator: "p1", text: "原文" }],
    quiz: [
      {
        id: "q1",
        question: "?",
        options: ["1", "2"],
        answer: 0,
        explanation: "因为",
        chapter: "a",
      },
    ],
    sources: [{ id: 1, title: "书" }],
    ...overrides,
  };
  return value as Omit<typeof value, "chapters"> & {
    chapters: FixtureChapter[];
    data?: Record<string, unknown>;
  };
}

test("a topic that satisfies the shared contract passes unchanged", () => {
  const value = content();
  assert.equal(validateTopicContent(value), value);
});

test("cross references and answer ranges are checked", () => {
  const cases = [
    [{ quiz: [{ ...content().quiz[0], id: undefined }] }, /quiz .* id/],
    [{ quiz: [content().quiz[0], content().quiz[0]] }, /duplicate id/],
    [
      { quiz: [{ ...content().quiz[0], optionExplanations: ["a"] }] },
      /one explanation per option/,
    ],
    [
      { quiz: [{ ...content().quiz[0], explanation: undefined }] },
      /explanation must be text/,
    ],
    [
      { chapters: [content().chapters[0], content().chapters[0]] },
      /duplicate chapter a/,
    ],
    [
      { chapters: [{ ...content().chapters[0], refs: [2] }] },
      /unknown source 2/,
    ],
    [
      { chapters: [{ ...content().chapters[0], excerpts: ["missing"] }] },
      /unknown excerpt missing/,
    ],
    [
      { quiz: [{ ...content().quiz[0], answer: 2 }] },
      /quiz q1 answer is out of range/,
    ],
    [{ quiz: [{ ...content().quiz[0], chapter: "b" }] }, /unknown chapter/],
    [
      { chapters: [{ ...content().chapters[0], terms: "t" }] },
      /chapter a terms must be a list of term names/,
    ],
    [
      { chapters: [{ ...content().chapters[0], terms: ["t", "t"] }] },
      /chapter a terms repeat a term/,
    ],
    [
      {
        chapters: [
          {
            ...content().chapters[0],
            blocks: [{ type: "paragraph", text: 5 }],
          },
        ],
      },
      /text must be text/,
    ],
    [
      {
        chapters: [
          {
            ...content().chapters[0],
            blocks: [
              {
                type: "choice",
                id: "a",
                question: "?",
                options: ["x", "y"],
                answer: 3,
                explanation: "e",
              },
            ],
          },
        ],
      },
      /answer is out of range/,
    ],
    [
      { excerpts: [{ id: "e1", source: 1, locator: "p1" }] },
      /no text or image/,
    ],
  ];
  for (const [overrides, message] of cases)
    assert.throws(() => validateTopicContent(content(overrides)), message);
});

test("structure exercises name the molecule, the right indices and a known excerpt", () => {
  const structure = {
    type: "structure",
    id: "a",
    kind: "atoms",
    question: "哪个碳？",
    molecule: { name: "m", smiles: "ClC1=CC=CC=C1" },
    answer: [0],
    explanation: "因为",
    excerpt: "e1",
  };
  const withPrediction = (prediction: unknown) => blocksContent([prediction]);
  assert.doesNotThrow(() => validateTopicContent(withPrediction(structure)));
  const choiceBlock = content().chapters[0].blocks[2];
  const cases = [
    [{ ...structure, molecule: { name: "m" } }, /smiles/],
    [{ ...structure, answer: [] }, /answer/],
    [{ ...structure, answer: [-1] }, /answer/],
    [{ ...structure, explanation: "" }, /explanation/],
    [{ ...structure, excerpt: "missing" }, /unknown excerpt/],
    [{ ...structure, molecules: [{ smiles: "C" }] }, /name/],
    [{ ...structure, kind: "" }, /kind/],
    [{ ...structure, kind: "mapping" }, /kind mapping is not in the catalogue/],
    [{ ...choiceBlock, molecules: {} }, /molecules/],
    [{ ...choiceBlock, options: ["x"] }, /two options/],
    [{ ...choiceBlock, question: "" }, /question/],
  ];
  for (const [prediction, message] of cases)
    assert.throws(
      () => validateTopicContent(withPrediction(prediction)),
      message,
    );
});

test("every chapter lists its sources", () => {
  const { refs: _, ...chapter } = content().chapters[0];
  assert.throws(
    () => validateTopicContent(content({ chapters: [chapter] })),
    /needs refs/,
  );
});

function blocksContent(blocks: unknown, extra = {}) {
  const base = content();
  return { ...base, ...extra, chapters: [{ ...base.chapters[0], blocks }] };
}
const choice = {
  type: "choice",
  id: "a",
  question: "哪个？",
  options: ["x", "y"],
  answer: 1,
  explanation: "因为 y",
};

test("a blocks chapter passes when every block fits the catalogue", () => {
  const value = blocksContent(
    [
      { type: "heading", text: "正文" },
      { type: "paragraph", text: "一段 [1]" },
      choice,
      { type: "paragraph", text: "结论" },
      {
        type: "table",
        caption: "表",
        columns: ["x", "y"],
        rows: "rows",
      },
      {
        type: "lab",
        model: "plate-capacity",
        label: "孔板",
        defaults: { capacity: 96 },
      },
      { type: "quiz", questions: ["q1"] },
      { type: "excerpt", excerpt: "e1" },
      { type: "reading", scope: "topic" },
      {
        type: "structure",
        id: "second",
        kind: "atoms",
        question: "?",
        molecule: { name: "m", smiles: "CC" },
        answer: [0],
        explanation: "e",
      },
      {
        type: "callout",
        text: "两题都答完",
        tone: "evidence",
      },
    ],
    {
      data: {
        rows: [["1", "2"]],
      },
    },
  );
  assert.equal(validateTopicContent(value), value);
  assert.deepEqual(
    chapterExercises(validateTopicContent(value).chapters[0]).map(
      (entry) => entry.id,
    ),
    ["a", "second"],
  );
});

test("blocks are checked against the catalogue and their references", () => {
  const cases = [
    [[{ type: "poem", text: "x" }], /is not a block type/],
    [[choice, { ...choice }], /repeats id a/],
    [[{ ...choice, id: undefined }], /id must be text/],
    [[{ ...choice, type: "prediction" }], /is not a block type/],
    [
      [{ type: "table", caption: "表", columns: ["x", "y"], rows: [["1"]] }],
      /one text, link or structure cell per column/,
    ],
    [
      [{ type: "table", caption: "表", columns: ["x"], rows: "missing" }],
      /unknown data missing/,
    ],
    [[{ type: "lab", model: "unknown", label: "l" }], /not in the catalogue/],
    [
      [
        {
          type: "lab",
          model: "plate-capacity",
          label: "l",
          defaults: { acids: 99 },
        },
      ],
      /outside the input's range/,
    ],
    [[{ type: "quiz", questions: ["nope"] }], /unknown quiz question nope/],
    [[{ type: "excerpt", excerpt: "nope" }], /unknown excerpt nope/],
    [[{ type: "callout", text: "x", tone: "loud" }], /tone must be one of/],
  ];
  for (const [blocks, message] of cases)
    assert.throws(() => validateTopicContent(blocksContent(blocks)), message);
});

const matrixInput = {
  rows: [{ id: "a", label: "A" }],
  columns: [{ id: "x", label: "X" }],
  outcomes: [
    { id: "yes", label: "有", tone: "success" },
    { id: "no", label: "无", tone: "danger" },
  ],
  choices: ["yes", "no"],
  required: ["a:x"],
  cells: [
    {
      row: "a",
      column: "x",
      outcome: "yes",
      evidence: [{ source: 1, locator: "p1" }],
    },
  ],
};
const tableInput = {
  columns: [{ key: "ic50", label: "IC50", unit: "nM", scale: "log" }],
  rows: [{ id: "1", label: "1", values: { ic50: { raw: "12" } } }],
};
const structureInput = {
  fetchedOn: "2026-01-01",
  entries: [
    {
      id: "5V3O",
      label: "5V3O",
      url: "/sites/x/static/5V3O.pdb",
      source: { pdb: "5V3O", title: "t" },
      subset: { residues: { A: [1, 10] }, hetero: [] },
      layers: [{ select: { chain: "A" }, style: "cartoon", color: "grey" }],
      presets: [],
    },
  ],
};

test("data components, formulas and the other exercise kinds are blocks too", () => {
  const value = blocksContent(
    [
      { type: "formula", tex: "k = A e^{-E_a/RT}", caption: "Arrhenius" },
      {
        type: "matrix",
        id: "grid",
        matrix: "grid",
        question: "{row} 对 {column}？",
        label: "矩阵",
        caption: "c",
        rowHeader: "行",
      },
      { type: "data-table", table: tableInput, title: "表", label: "数据" },
      { type: "structure-lab", set: structureInput, ids: ["5V3O"] },
      {
        type: "structure",
        id: "set",
        kind: "atom-set",
        question: "?",
        molecules: [{ name: "m", smiles: "CC", answer: [0] }],
        explanation: "e",
      },
      {
        type: "structure",
        id: "arrow",
        kind: "arrows",
        question: "?",
        molecule: { name: "m", smiles: "CC" },
        answer: { from: 0, to: 1 },
        explanation: "e",
      },
    ],
    { data: { grid: matrixInput } },
  );
  assert.equal(validateTopicContent(value), value);
  const predictions = chapterExercises(
    validateTopicContent(value).chapters[0],
    validateTopicContent(value).data,
  );
  assert.deepEqual(
    predictions.map((entry) => [
      entry.id,
      entry.exercise.kind ?? entry.exercise.type,
    ]),
    [
      ["grid", "matrix"],
      ["set", "atom-set"],
      ["arrow", "arrows"],
    ],
  );
  assert.ok(
    predictions[0].exercise.type === "matrix" &&
      predictions[0].exercise.model.isComplete({ "a:x": 0 }),
  );
});

test("bad data component input and unknown exercise kinds are rejected with the block named", () => {
  const cases = [
    [
      [
        {
          type: "matrix",
          matrix: { ...matrixInput, required: ["a:z"] },
          question: "q",
          label: "l",
          caption: "c",
          rowHeader: "r",
        },
      ],
      /block 1 \(matrix\) matrix: /,
    ],
    [
      [
        {
          type: "data-table",
          table: {
            ...tableInput,
            rows: [...tableInput.rows, ...tableInput.rows],
          },
          title: "t",
          label: "l",
        },
      ],
      /Duplicate row id/,
    ],
    [
      [{ type: "structure-lab", set: structureInput, ids: ["missing"] }],
      /missing/,
    ],
    [
      [{ type: "structure", kind: "rank", question: "?", explanation: "e" }],
      /kind rank is not in the catalogue/,
    ],
    [
      [
        {
          type: "structure",
          id: "a",
          kind: "arrows",
          question: "?",
          molecule: { name: "m", smiles: "CC" },
          answer: { from: 1, to: 1 },
          explanation: "e",
        },
      ],
      /answer must be \{ from, to \}/,
    ],
    [
      [
        {
          type: "structure",
          id: "a",
          kind: "atom-set",
          question: "?",
          molecules: [{ name: "m", smiles: "CC", answer: [] }],
          explanation: "e",
        },
      ],
      /answer must list atoms/,
    ],
  ];
  for (const [blocks, message] of cases)
    assert.throws(() => validateTopicContent(blocksContent(blocks)), message);
});

test("number exercises, lab presets and reveal, linked cells and sources blocks", () => {
  const value = blocksContent(
    [
      {
        type: "number",
        id: "a",
        question: "估计 ΔΔG？",
        input: { label: "ΔΔG", unit: "kJ/mol", min: 0, step: 0.1 },
        answer: 8.5,
        tolerance: 1,
        readout: { model: "plate-capacity", input: "acids" },
        explanation: "e",
      },
      {
        type: "lab",
        model: "plate-capacity",
        label: "孔板",
        reveal: { label: "查看实测" },
        presets: [{ label: "小板", values: { capacity: 24, acids: 2 } }],
      },
      {
        type: "table",
        caption: "母体",
        columns: ["名", "CID"],
        rows: [
          [
            "苯甲醛",
            {
              text: "240",
              href: "https://pubchem.ncbi.nlm.nih.gov/compound/240",
            },
          ],
        ],
      },
      { type: "quiz", questions: ["q1"], diagnostic: true },
    ],
    {
      sourcesIntro: {
        title: "来源与核对",
        blocks: [
          { type: "paragraph", text: "说明" },
          { type: "excerpt", excerpt: "e1" },
        ],
      },
    },
  );
  assert.equal(validateTopicContent(value), value);
  const cases = [
    [
      [
        {
          type: "number",
          id: "a",
          question: "?",
          input: { label: "x" },
          tolerance: 1,
          explanation: "e",
        },
      ],
      /tolerance needs an answer/,
    ],
    [
      [
        {
          type: "number",
          id: "a",
          question: "?",
          input: { label: "x" },
          readout: { model: "plate-capacity", input: "capacity" },
          explanation: "e",
        },
      ],
      /not a number input/,
    ],
    [
      [
        {
          type: "lab",
          model: "plate-capacity",
          label: "l",
          presets: [{ label: "p", values: { acids: 99 } }],
        },
      ],
      /preset 1 values value for acids/,
    ],
    [
      [
        {
          type: "table",
          caption: "t",
          columns: ["a"],
          rows: [[{ text: "x" }]],
        },
      ],
      /text, link or structure/,
    ],
  ];
  for (const [blocks, message] of cases)
    assert.throws(() => validateTopicContent(blocksContent(blocks)), message);
  assert.throws(
    () =>
      validateTopicContent(
        blocksContent([], { sourcesIntro: { title: "t", blocks: [choice] } }),
      ),
    /sourcesIntro cannot hold a choice block/,
  );
});

test("spectrum blocks list peaks of one molecule and may hold the assignment back", () => {
  const peak = {
    id: "a",
    ppm: 7.2,
    hydrogens: 5,
    multiplicity: "m",
    atoms: [1, 2],
    assignment: "芳环 H",
  };
  const value = blocksContent([
    choice,
    {
      type: "spectrum",
      molecule: { name: "m", smiles: "c1ccccc1C" },
      peaks: [peak],
      assignAfter: ["a"],
    },
    {
      type: "table",
      caption: "t",
      columns: ["a", "b"],
      rows: [["x [1]", "1"]],
      rowHeader: true,
    },
  ]);
  assert.equal(validateTopicContent(value), value);
  for (const [blocks, message] of [
    [
      [
        {
          type: "spectrum",
          molecule: { name: "m", smiles: "C" },
          peaks: [peak, peak],
        },
      ],
      /repeats id a/,
    ],
    [
      [
        {
          type: "spectrum",
          molecule: { name: "m", smiles: "C" },
          peaks: [peak],
          assignAfter: ["a"],
        },
      ],
      /assignAfter must list exercises earlier/,
    ],
  ])
    assert.throws(() => validateTopicContent(blocksContent(blocks)), message);
});

test("quiz blocks have stable ids; arrows may carry a choice; molecules compare side by side", () => {
  const value = blocksContent(
    [
      { type: "quiz", id: "start", questions: ["q1"], diagnostic: true },
      { type: "paragraph", text: "教材案例" },
      {
        type: "structure",
        id: "sn",
        kind: "arrows",
        question: "?",
        molecule: { name: "m", smiles: "CCBr" },
        answer: { from: 0, to: 1 },
        options: ["SN1", "SN2"],
        optionAnswer: 1,
        explanation: "e",
      },
      {
        type: "molecule-compare",
        items: [
          { name: "a", smiles: "CC", highlightAtoms: [0] },
          { name: "b", smiles: "CCC" },
        ],
        left: "b",
        highlightLabel: "标出锚定环",
      },
      { type: "lab", model: "plate-capacity", label: "l", data: "rows" },
    ],
    { data: { rows: [["1", "2"]] } },
  );
  assert.equal(validateTopicContent(value), value);
  assert.deepEqual(
    chapterExercises(validateTopicContent(value).chapters[0]).map((entry) => [
      entry.id,
      entry.exercise.kind ?? entry.exercise.type,
    ]),
    [
      ["start", "quiz"],
      ["sn", "arrows"],
    ],
  );
  for (const [blocks, message] of [
    [
      [
        {
          type: "structure",
          id: "a",
          kind: "arrows",
          question: "?",
          molecule: { name: "m", smiles: "CC" },
          answer: { from: 0, to: 1 },
          optionAnswer: 0,
          explanation: "e",
        },
      ],
      /optionAnswer needs options/,
    ],
    [
      [
        {
          type: "molecule-compare",
          items: [
            { name: "a", smiles: "CC" },
            { name: "b", smiles: "CCC" },
          ],
          right: "zz",
        },
      ],
      /right must name one of the items/,
    ],
    [
      [{ type: "lab", model: "plate-capacity", label: "l", data: "nope" }],
      /unknown data nope/,
    ],
  ])
    assert.throws(() => validateTopicContent(blocksContent(blocks)), message);
});

test("design and ranking exercises are checked", () => {
  const design = {
    type: "structure",
    id: "a",
    kind: "design",
    question: "?",
    molecule: { name: "m", smiles: "CCCC" },
    groups: [[0], [3]],
    options: ["a", "b"],
    answer: 1,
    explanation: "e",
  };
  const ranking = {
    type: "ranking",
    id: "r",
    question: "?",
    options: ["a", "b"],
    answer: 0,
    explanation: "e",
  };
  assert.doesNotThrow(() =>
    validateTopicContent(blocksContent([design, ranking])),
  );
  for (const [blocks, message] of [
    [[{ ...design, groups: [[]] }], /groups must be non-empty/],
    [[{ ...design, answer: 5 }], /answer is out of range/],
    [[{ ...ranking, options: ["a"] }], /at least two options/],
  ])
    assert.throws(() => validateTopicContent(blocksContent(blocks)), message);
});

test("chart domains, diagnostic summaries and atom sets with a choice are checked", () => {
  assert.doesNotThrow(() =>
    validateTopicContent(
      blocksContent([
        {
          type: "chart",
          points: [{ x: -2, y: 1 }],
          xLabel: "x",
          yLabel: "y",
          xDomain: [-2, 5],
          yDomain: [0, 100],
        },
        { type: "diagnostic-summary", title: "你的阅读建议" },
        {
          type: "structure",
          id: "a",
          kind: "atom-set",
          question: "?",
          molecules: [{ name: "m", smiles: "CC", answer: [0] }],
          options: ["a", "b"],
          optionAnswer: 0,
          gradeAtoms: false,
          explanation: "e",
        },
      ]),
    ),
  );
  assert.throws(
    () =>
      validateTopicContent(
        blocksContent([
          {
            type: "chart",
            points: [{ x: 0, y: 1 }],
            xLabel: "x",
            yLabel: "y",
            xDomain: [5, 1],
          },
        ]),
      ),
    /xDomain must be \[min, max\]/,
  );
});

test("timeline and flow blocks are checked, may keep their value in data and are searchable", () => {
  const timeline = {
    axis: { from: 1964, to: 1976, every: 2 },
    events: [
      { date: 1964, text: "搭起筛子" },
      { between: [1968, 1970], text: "回头看" },
    ],
    brackets: [{ from: 1964, to: 1976, text: "12 年" }],
  };
  const blocks = [
    { type: "timeline", timeline: "welwyn", caption: "项目" },
    {
      type: "flow",
      flow: {
        nodes: [
          { id: "a", text: "鸦片" },
          { id: "b", text: "母液" },
        ],
        edges: ["a > b"],
      },
    },
  ];
  assert.doesNotThrow(() =>
    validateTopicContent(blocksContent(blocks, { data: { welwyn: timeline } })),
  );
  assert.deepEqual(
    blockSearchText(
      validateTopicContent(
        blocksContent(blocks, { data: { welwyn: timeline } }),
      ).chapters[0].blocks,
      { welwyn: timeline },
    ),
    ["项目", "1964", "搭起筛子", "回头看", "12 年", "鸦片", "母液"],
  );
  for (const [value, pattern] of [
    [
      { events: [{ date: 1980, text: "x" }], axis: { from: 1964, to: 1976 } },
      /block 1 \(timeline\) timeline: timeline has a date outside its axis/,
    ],
    [
      { events: [{ between: [1970, 1968], text: "x" }] },
      /between must run forward in time/,
    ],
    [
      { events: [{ date: 1970, text: "x", colour: "red" }] },
      /unknown field colour/,
    ],
  ])
    assert.throws(
      () =>
        validateTopicContent(
          blocksContent([{ type: "timeline", timeline: value }]),
        ),
      pattern,
    );
  assert.throws(
    () =>
      validateTopicContent(
        blocksContent([
          {
            type: "flow",
            flow: {
              nodes: [
                { id: "a", text: "a" },
                { id: "b", text: "b" },
              ],
              edges: ["a > c"],
            },
          },
        ]),
      ),
    /block 1 \(flow\) flow: flow edge 1 names node c, which does not exist; the nodes are a, b/,
  );
});

test("search text reads panels, table cells and tab contents kept in data", () => {
  assert.deepEqual(
    blockSearchText(
      [
        {
          type: "panels",
          mode: "compare",
          items: [
            { title: "t", text: "x", ref: "img_first" },
            { title: "u", text: "y", ref: "img_second" },
          ],
        },
        { type: "heading", text: "h" },
        { type: "table", caption: "表", columns: ["靶点", "值"], rows: "rows" },
        {
          type: "tabs",
          label: "例",
          items: [
            {
              id: "a",
              label: "Example 1",
              blocks: [{ type: "paragraph", text: "内" }],
            },
          ],
        },
      ],
      {
        rows: [["TGT1", { text: "240", href: "https://example.org" }]],
      },
    ),
    [
      "",
      "t",
      "x",
      "u",
      "y",
      "h",
      "表",
      "靶点",
      "值",
      "TGT1",
      "240",
      "Example 1",
      "内",
    ],
  );
});

test("image-point exercises name their points and answer", () => {
  const picture = {
    type: "choice",
    id: "a",
    kind: "image-points",
    question: "?",
    image: { src: "/x.svg", alt: "图" },
    points: [
      { id: "a", label: "A", x: 10, y: 20 },
      { id: "b", label: "B", x: 50, y: 60 },
    ],
    answer: ["b"],
    explanation: "e",
  };
  assert.doesNotThrow(() => validateTopicContent(blocksContent([picture])));
  assert.doesNotThrow(() =>
    validateTopicContent(
      blocksContent([{ ...picture, image: { ref: "img_example" } }]),
    ),
  );
  assert.throws(
    () =>
      validateTopicContent(
        blocksContent([{ ...picture, image: { ref: "cmp_example" } }]),
      ),
    /expected image reference/,
  );
  assert.throws(
    () => validateTopicContent(blocksContent([{ ...picture, answer: ["zz"] }])),
    /answer must list point ids/,
  );
  assert.throws(
    () =>
      validateTopicContent(
        blocksContent([
          {
            ...picture,
            points: [{ id: "a", label: "A", x: 101, y: 0 }, picture.points[1]],
          },
        ]),
      ),
    /x must be a percentage/,
  );
});

test("atom counts bound exercise indices; reading blocks may show the chapter's guide", () => {
  assert.doesNotThrow(() =>
    validateTopicContent(
      blocksContent([{ type: "reading", scope: "chapter" }]),
    ),
  );
  assert.throws(
    () =>
      validateTopicContent(
        blocksContent([
          {
            type: "structure",
            id: "a",
            kind: "atoms",
            question: "?",
            molecule: { name: "m", smiles: "CC", atoms: 2 },
            answer: [2],
            explanation: "e",
          },
        ]),
      ),
    /index outside the molecule's 2/,
  );
});

test("learning paths name known chapters and a path picker needs them", () => {
  const paths = [
    { id: "all", title: "完整", summary: "全部", chapters: ["a"] },
  ];
  assert.doesNotThrow(() =>
    validateTopicContent(
      blocksContent([{ type: "path-picker", title: "路径" }], { paths }),
    ),
  );
  assert.throws(
    () => validateTopicContent(blocksContent([{ type: "path-picker" }])),
    /path-picker block needs top-level paths/,
  );
  assert.throws(
    () =>
      validateTopicContent(
        blocksContent([], { paths: [{ ...paths[0], chapters: ["zz"] }] }),
      ),
    /chapters must list known chapter ids/,
  );
});

test("tabs hold static block sequences with independent contents", () => {
  const tabs = {
    type: "tabs",
    label: "实施例",
    items: [
      {
        id: "ex3",
        label: "Example 3",
        blocks: [
          { type: "paragraph", text: "三" },
          { type: "excerpt", excerpt: "e1" },
        ],
      },
      {
        id: "ex5",
        label: "Example 5",
        blocks: [{ type: "paragraph", text: "五" }],
      },
    ],
  };
  assert.doesNotThrow(() =>
    validateTopicContent(blocksContent([choice, tabs])),
  );
  assert.doesNotThrow(() =>
    validateTopicContent(blocksContent([choice, { ...tabs, default: "ex5" }])),
  );
  for (const value of ["missing", "", null, 1]) {
    assert.throws(
      () =>
        validateTopicContent(
          blocksContent([choice, { ...tabs, default: value }]),
        ),
      /default must reference an item id/,
    );
  }
  assert.throws(
    () =>
      validateTopicContent(
        blocksContent([
          {
            ...tabs,
            items: [tabs.items[0], { id: "p", label: "p", blocks: [choice] }],
          },
        ]),
      ),
    /cannot hold a choice block/,
  );
  assert.throws(
    () =>
      validateTopicContent(
        blocksContent([
          { ...tabs, items: [tabs.items[0], { ...tabs.items[0] }] },
        ]),
      ),
    /repeats id ex3/,
  );
  assert.doesNotThrow(() =>
    validateTopicContent(
      blocksContent([
        { type: "lab", model: "plate-capacity", label: "l", reset: true },
      ]),
    ),
  );
});

test("a chapter's own path overrides chapterRoute and must stay unique", () => {
  const base = content();
  const two = {
    ...base,
    chapterRoute: "/chapters/{number}",
    parts: [{ title: "一", chapters: ["map", "a"] }],
    chapters: [
      {
        id: "map",
        number: 0,
        title: "地图",
        refs: [1],
        path: "/map",
        blocks: [],
      },
      base.chapters[0],
    ],
  };
  assert.equal(validateTopicContent(two), two);
  assert.equal(chapterRoutePath(two, two.chapters[0]), "/map");
  assert.equal(chapterRoutePath(two, two.chapters[1]), "/chapters/1");
  assert.throws(
    () =>
      validateTopicContent({
        ...two,
        chapters: [{ ...two.chapters[0], path: "chapters" }, two.chapters[1]],
      }),
    /path must start with/,
  );
  assert.throws(
    () =>
      validateTopicContent({
        ...two,
        chapters: [
          { ...two.chapters[0], path: "/chapters/1" },
          two.chapters[1],
        ],
      }),
    /same path/,
  );
});

test("unknown block fields are rejected", () => {
  assert.throws(
    () =>
      validateTopicContent(
        blocksContent([
          choice,
          { type: "paragraph", text: "正文", revealAfter: ["a"] },
        ]),
      ),
    /unknown field revealAfter/,
  );
});

const problem = () => ({
  type: "problem",
  id: "open",
  lang: "en",
  prompt: ["Compare the samples.", "Explain your reasoning."],
  parts: ["Count the objects."],
  answer: {
    text: ["One more object."],
    origin: "book",
    basis: "Neutral example, p. 1",
  },
  evidence: ["e1"],
});
test("problem contract checks required fields, whitelists, shared ids and evidence", () => {
  const withProblem = (block: RawBlock) => {
    const value = content();
    value.chapters[0].blocks.push(block);
    return value;
  };
  validateTopicContent(withProblem(problem()));
  const partsOnly = problem();
  Reflect.deleteProperty(partsOnly, "prompt");
  validateTopicContent(withProblem(partsOnly));
  Reflect.deleteProperty(partsOnly, "parts");
  assert.throws(
    () => validateTopicContent(withProblem(partsOnly)),
    /prompt or parts/,
  );
  for (const key of ["id", "lang", "answer"]) {
    const block = problem();
    Reflect.deleteProperty(block, key);
    assert.throws(() => validateTopicContent(withProblem(block)), Error, key);
  }
  for (const key of ["text", "origin", "basis"]) {
    const block = problem();
    Reflect.deleteProperty(block.answer, key);
    assert.throws(() => validateTopicContent(withProblem(block)), Error, key);
  }
  for (const patch of [
    { unexpected: true },
    { lang: "fr" },
    { prompt: [] },
    { parts: [] },
    { parts: [""] },
    { answer: { ...problem().answer, unexpected: true } },
    { answer: { ...problem().answer, origin: "other" } },
    { evidence: ["missing"] },
    { id: "a" },
  ])
    assert.throws(() =>
      validateTopicContent(withProblem({ ...problem(), ...patch })),
    );
  const duplicate = withProblem(problem());
  duplicate.chapters.push({
    id: "b",
    title: "Other",
    refs: [],
    blocks: [{ ...problem(), evidence: [] }],
  });
  assert.throws(() => validateTopicContent(duplicate), /repeats exercise id/);
  const outside = withProblem(problem());
  outside.chapters[0].excerpts = [];
  validateTopicContent(outside);
  assert.deepEqual(
    blockSearchText(
      validateTopicContent(
        blocksContent([problem(), content().chapters[0].blocks[2]]),
      ).chapters[0].blocks,
    ),
    [],
  );
});

test("exercise source accepts only nonempty text", () => {
  const value = content();
  value.chapters[0].blocks[2].source = "Neutral source";
  validateTopicContent(value);
  for (const source of ["", 2, null]) {
    value.chapters[0].blocks[2].source = source;
    assert.throws(() => validateTopicContent(value), /source/);
  }
});

test("exercise evidence references topic excerpts and rejects malformed or missing ids", () => {
  const value = content();
  value.chapters[0].excerpts = [];
  value.chapters[0].blocks[2].evidence = ["e1"];
  validateTopicContent(value);
  for (const evidence of ["e1", [2], ["missing"]]) {
    value.chapters[0].blocks[2].evidence = evidence;
    assert.throws(
      () => validateTopicContent(value),
      /evidence|unknown excerpt/,
    );
  }
});

test("the topic home cannot be used as a chapter path", () => {
  const value = content();
  value.chapters[0].path = "/";
  assert.throws(() => validateTopicContent(value), /cannot be \//);
});

test("panels group adjacent steps and select columns at their readable widths", async () => {
  const { definePanels, panelGroups, panelColumns } =
    await import("../shared/panels.ts");
  const items = [
    { title: "First", text: "Input", ref: "img_one" },
    { title: "Second", text: "Continue", ref: "img_one" },
    { title: "Third", text: "Result", ref: "img_two" },
    { title: "Fourth", text: "Return", ref: "img_one", frame: "detail" },
  ];
  const steps = definePanels({ mode: "steps", items });
  assert.deepEqual(
    panelGroups(steps).map((group) => group.indices),
    [[0, 1], [2], [3]],
  );
  assert.equal(panelGroups(definePanels({ mode: "compare", items })).length, 4);
  assert.equal(panelColumns(2, 680, 330), 2);
  assert.equal(panelColumns(3, 680, 608), 1);
  assert.equal(panelColumns(4, 1000, 200), 2);
  assert.equal(panelColumns(6, 680, 280), 2);
  assert.equal(panelColumns(3, 1000, 280), 3);
  assert.equal(panelColumns(2, 358, 330), 1);
  validateTopicContent(
    blocksContent([{ type: "panels", mode: "steps", items }]),
    "sample",
  );
  for (const [input, error] of [
    [{ mode: "compare", items: items.slice(0, 1) }, /只有 1 项/],
    [{ mode: "other", items }, /mode/],
    [
      {
        mode: "compare",
        items: [items[0], { title: "Missing", text: "Description" }],
      },
      /第 2 项.*ref 或 flow/,
    ],
    [
      {
        mode: "compare",
        items: [
          items[0],
          {
            title: "Flow",
            text: "Description",
            flow: {
              nodes: [
                { id: "a", text: "A" },
                { id: "b", text: "B" },
              ],
              edges: ["a > b"],
              steps: [],
            },
          },
        ],
      },
      /第 2 项.*不能写 steps/,
    ],
  ] as const)
    assert.throws(
      () =>
        validateTopicContent(
          blocksContent([{ type: "panels", ...input }]),
          "sample",
        ),
      error,
    );
});
