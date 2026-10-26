import test from "node:test";
import assert from "node:assert/strict";
import { validateGlossary } from "../scripts/glossary.mjs";

const entry = {
  term: "占有率",
  full: "occupancy",
  definition: "靶点被配体结合的比例。",
  confusion: "不是抑制率。",
};

test("a complete glossary with unique names passes unchanged", () => {
  const glossary = [entry, { ...entry, term: "Kd" }];
  assert.equal(validateGlossary(glossary), glossary);
});

test("incomplete, unknown, malformed and duplicate entries are rejected with their position", () => {
  for (const [glossary, pattern] of [
    [{ 占有率: entry }, /expected an array/],
    [[{ ...entry, confusion: "" }], /\[0\]: confusion must be text/],
    [[{ ...entry, full: undefined }], /\[0\]: full must be text/],
    [[{ ...entry, refs: [1] }], /\[0\]: unknown refs/],
    [[{ ...entry, term: " 占有率" }], /invalid term name/],
    [[{ ...entry, term: "a]b" }], /invalid term name/],
    [[entry, entry], /\[1\]: duplicate term 占有率/],
  ])
    assert.throws(() => validateGlossary(glossary), pattern);
});
