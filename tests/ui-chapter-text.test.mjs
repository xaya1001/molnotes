import { test } from "node:test";
import assert from "node:assert/strict";
import { blockPieces, sourceIdsOf } from "../src/ui/topic/chapter-text.ts";

const terms = ["IC50", "占有率", "占有率曲线"];

test("blocks: source numbers everywhere, terms at their first occurrence across prose", () => {
  const pieces = blockPieces(
    [
      { type: "paragraph", text: "占有率先于 IC50 [1]。" },
      {
        type: "prediction",
        id: "p",
        question: "?",
        options: ["a", "b"],
        answer: 0,
        explanation: "e",
      },
      { type: "callout", text: "IC50 与占有率 [5,7]" },
      { type: "paragraph", text: "IC50 再次出现" },
    ],
    terms,
  );
  assert.deepEqual(pieces[0], [
    { kind: "term", name: "占有率" },
    { kind: "text", text: "先于 " },
    { kind: "term", name: "IC50" },
    { kind: "text", text: " " },
    { kind: "refs", ids: [1] },
    { kind: "text", text: "。" },
  ]);
  assert.equal(pieces[1], null);
  assert.deepEqual(pieces[2], [
    { kind: "text", text: "IC50 与占有率 " },
    { kind: "refs", ids: [5, 7] },
  ]);
  assert.deepEqual(pieces[3], [{ kind: "text", text: "IC50 再次出现" }]);
});

test("a bracketed number with a leading zero is a patent paragraph, not a source", () => {
  assert.deepEqual(
    blockPieces([{ type: "paragraph", text: "见 [0418] 与 [3]。" }], []),
    [
      [
        { kind: "text", text: "见 [0418] 与 " },
        { kind: "refs", ids: [3] },
        { kind: "text", text: "。" },
      ],
    ],
  );
});

test("with the topic's source ids, only known numbers become source buttons", () => {
  assert.deepEqual(
    blockPieces(
      [{ type: "paragraph", text: "Example 1 · [1325]–[1327]，见 [3]。" }],
      [],
      new Set([3]),
    ),
    [
      [
        { kind: "text", text: "Example 1 · " },
        { kind: "text", text: "[1325]" },
        { kind: "text", text: "–" },
        { kind: "text", text: "[1327]" },
        { kind: "text", text: "，见 " },
        { kind: "refs", ids: [3] },
        { kind: "text", text: "。" },
      ],
    ],
  );
});

test("the longest term wins where terms overlap, and the shorter one stays available", () => {
  const [pieces] = blockPieces(
    [{ type: "paragraph", text: "占有率曲线，占有率" }],
    terms,
  );
  assert.deepEqual(
    pieces.filter((p) => p.kind === "term").map((p) => p.name),
    ["占有率曲线", "占有率"],
  );
});

test("source IDs preserve sigmatropic and patent notation while linking real citations", () => {
  assert.deepEqual(
    blockPieces(
      [{ type: "paragraph", text: "[3,3] 重排；[1325] 段；来源 [5,7]。" }],
      [],
      sourceIdsOf([{ id: "3" }, { id: 5 }, { id: 7 }]),
    ),
    [
      [
        { kind: "text", text: "[3,3]" },
        { kind: "text", text: " 重排；" },
        { kind: "text", text: "[1325]" },
        { kind: "text", text: " 段；来源 " },
        { kind: "refs", ids: [5, 7] },
        { kind: "text", text: "。" },
      ],
    ],
  );
});
