import test from "node:test";
import assert from "node:assert/strict";
import { planChangedFiles } from "../scripts/ci-plan.ts";
test("documentation and routing-rule edits use the docs lane", () => {
  assert.equal(
    planChangedFiles(["README.md", ".codex/config.toml", "scripts/ci-plan.ts"])
      .mode,
    "docs",
  );
});
test("runtime, content fixture and deployment edits require full checks", () => {
  for (const path of [
    "src/ui/topic/records.ts",
    "tests/fixtures/content/notes/reader-test/first.md",
    "compose.yml",
    "package-lock.json",
  ]) {
    const expected = "full";
    assert.equal(planChangedFiles([path]).mode, expected);
  }
});
