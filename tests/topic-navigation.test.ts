import { validateTopicContent } from "../shared/topic-content.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { readUnit } from "../scripts/content/content-files.ts";
import { topicRecordsCodec } from "../server/web/records.ts";
import { buildTopicIndex } from "../shared/topic-index.ts";
import { mergeRecords } from "../src/ui/record-sync.ts";
const unit = await readUnit(resolve("tests/fixtures/content"), "sites/sample");
assert.ok(unit.kind === "sites");
const content = unit.content;
test("recent chapters are validated and retained with slug records", () => {
  const codec = topicRecordsCodec(validateTopicContent(content));
  const base = { version: 1, ...codec.empty() };
  const recent = { chapter: "next", opened: 123 };
  assert.deepEqual(codec.parseRecords({ ...base, recent }).recent, recent);
  for (const recent of [
    { chapter: "missing", opened: 1 },
    { chapter: "next", opened: -1 },
    { chapter: "next", opened: "123" },
  ])
    assert.throws(() => codec.parseRecords({ ...base, recent }));
  const local = { ...base, recent: { chapter: "start", opened: 100 } };
  const remote = { ...base, recent };
  assert.deepEqual(mergeRecords(base, local, remote).recent, recent);
});
test("the index separates practice and cases while keeping chapter IDs", () => {
  const topics = buildTopicIndex([
    { slug: "practice", title: "P", group: "练习", content },
    { slug: "case", title: "C", group: "靶点案例", content },
  ]).chapters;
  assert.equal(topics[0].chapters[0].path, "/practice/practice/start");
  assert.equal(topics[1].chapters[0].path, "/sites/case/start");
});
