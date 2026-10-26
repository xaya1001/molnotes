import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { validateTopicContent } from "../scripts/topic-content.mjs";
test("scaffold creates an editable content unit and retains the literal title", () => {
  const root = mkdtempSync(join(tmpdir(), "il-scaffold-"));
  try {
    mkdirSync(join(root, "sites/existing"), { recursive: true });
    writeFileSync(
      join(root, "sites/existing/site.json"),
      JSON.stringify({
        title: "已有",
        description: "样本",
        order: 3,
        group: "谱图",
      }),
    );
    const title = "受体 <binding> {{ 7 * 7 }} </script>";
    const run = () =>
      spawnSync(
        process.execPath,
        [
          resolve("scripts/new-site.mjs"),
          "binding",
          title,
          "结合教学",
          "靶点案例",
        ],
        {
          env: { ...process.env, MOLNOTES_CONTENT_DIR: root },
          encoding: "utf8",
        },
      );
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(
      JSON.parse(readFileSync(join(root, "sites/binding/site.json"), "utf8")),
      { title, description: "结合教学", order: 4, group: "靶点案例" },
    );
    validateTopicContent(
      JSON.parse(
        readFileSync(join(root, "sites/binding/content.json"), "utf8"),
      ),
    );
    assert.notEqual(run().status, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
