import type FixtureFixture from "./fixtures/content/sites/instruments/content.json";
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { withInstrumentChapters } from "./helpers/instrument-chapters.ts";
import {
  validateTopicContent,
  chapterPredictions,
} from "../shared/topic-content.ts";

const fixture: typeof FixtureFixture = JSON.parse(
  await readFile(
    new URL(
      "./fixtures/content/sites/instruments/content.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

test("focused browser chapters preserve the composed sample, records and publication references", () => {
  const before = structuredClone(fixture);
  const content = withInstrumentChapters(fixture);
  validateTopicContent(content);
  assert.deepEqual(fixture, before);
  assert.deepEqual(content.chapters[0], before.chapters[0]);
  assert.deepEqual(content.data, before.data);
  assert.deepEqual(
    content.chapters.flatMap((chapter) =>
      chapterPredictions(
        chapter as import("../src/ui/topic/content.ts").TopicChapter,
      ).map(({ id }) => id),
    ),
    before.chapters.flatMap((chapter) =>
      chapterPredictions(
        chapter as import("../src/ui/topic/content.ts").TopicChapter,
      ).map(({ id }) => id),
    ),
  );
  const focused = content.chapters.slice(before.chapters.length);
  assert.ok(
    focused.every(
      (chapter) =>
        chapter.blocks.length > 0 &&
        chapter.blocks.length < before.chapters[0].blocks.length,
    ),
  );
  // Every dataset-driven lab gets one focused home; the inline plate lab stays
  // on the composed smoke page. Duplicates would hide accidental group overlap.
  assert.deepEqual(
    focused
      .flatMap((chapter) =>
        chapter.blocks
          .filter((block) => block.type === "lab")
          .map((block) => block.model),
      )
      .sort(),
    before.chapters[0].blocks
      .filter((block) => block.type === "lab" && block.data)
      .map((block) => block.model)
      .sort(),
  );
});
