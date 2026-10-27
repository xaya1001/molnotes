import type { Unchecked } from "../shared/unchecked.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { topicRecordsCodec } from "../server/web/records.ts";
import { buildTopicIndex } from "../shared/topic-index.ts";
const content = JSON.parse(
  readFileSync(
    new URL("./fixtures/content/sites/sample/content.json", import.meta.url),
    "utf8",
  ),
);
test("server record codec validates problem answers and omits empty entries", () => {
  const codec = topicRecordsCodec(content);
  const records = { version: 1, ...codec.empty() };
  for (const problems of [
    null,
    [],
    { missing: { response: "x" } },
    { "compare-zh": {} },
    { "compare-zh": { response: 1 } },
    { "compare-zh": { response: "x", rating: "maybe" } },
    { "compare-zh": { response: "x".repeat(20001) } },
    { "compare-zh": { response: "", extra: true } },
  ])
    assert.throws(() => codec.parseRecords({ ...records, problems }));
  for (const rating of ["know", "unknown", undefined]) {
    const entry = {
      response: "x".repeat(20000),
      ...(rating ? { rating } : {}),
    };
    assert.deepEqual(
      codec.parseRecords({ ...records, problems: { "compare-zh": entry } })
        .problems,
      { "compare-zh": entry },
    );
  }
  assert.deepEqual(
    codec.parseRecords({
      ...records,
      problems: { "compare-zh": { response: "" } },
    }).problems,
    {},
  );
  assert.deepEqual(
    codec.parseRecords({
      ...records,
      problems: { "compare-zh": { response: "", rating: "unknown" } },
    }).problems,
    { "compare-zh": { response: "", rating: "unknown" } },
  );
});
test("server topic index carries review data while excluding exercise text from search", () => {
  const index = buildTopicIndex([{ slug: "sample", title: "Sample", content }]);
  assert.equal(
    (index.chapters[0].predictions[0].prediction as Unchecked).answer,
    0,
  );
  assert.equal(index.chapters[0].problems.length, 2);
  assert.deepEqual(
    index.chapters[0].problems[0].parts,
    content.chapters[1].blocks[1].parts,
  );
  assert.ok(
    !JSON.stringify(index.search).includes("consistent observation procedure"),
  );
});
