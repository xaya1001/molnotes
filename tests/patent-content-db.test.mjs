import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, cp, readFile, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { testDatabase } from "./helpers/database.mjs";
import { assetStore } from "../server/assets.mjs";
import { pullUnit } from "../server/content-files.mjs";
import { pushUnits, removeUnit } from "../server/content-publish.mjs";
test(
  "patent publication validates lazy assets transactionally and retains existing content on failure",
  { skip: process.env.MOLNOTES_DATABASE_TESTS !== "1" },
  async () => {
    const db = await testDatabase();
    const root = await mkdtemp("/tmp/il-patent-test-");
    try {
      const content = join(root, "content");
      await cp(resolve("tests/fixtures/content"), content, { recursive: true });
      const store = await assetStore("dir:" + join(root, "objects"));
      await pushUnits(db.pool, store, content, ["sites/fable-patent"]);
      // A later publication validates the stored resource manifest and JSON bodies too.
      await pushUnits(db.pool, store, content, ["sites/sample"]);
      const path = join(content, "sites/fable-patent/content.json"),
        original = JSON.parse(await readFile(path, "utf8"));
      await pullUnit(
        db.pool,
        store,
        join(root, "export"),
        "sites/fable-patent",
        join(root, "pull-cache"),
      );
      assert.deepEqual(
        JSON.parse(
          await readFile(
            join(root, "export/sites/fable-patent/content.json"),
            "utf8",
          ),
        ),
        original,
      );
      for (const mutate of [
        (c) =>
          (c.data.collections.examples.records[0].potency.ref.asset =
            "/sites/fable-patent/static/absent.svg"),
        (c) =>
          (c.data.synthesis.fable.routes[0].evidence[0].asset =
            "/sites/fable-patent/static/absent.svg"),
        (c) =>
          (c.data.collections.examples.records[0].potency.assay = "unknown"),
        (c) =>
          (c.data.synthesis.fable.steps[0].reactants = [
            { collection: "examples", id: 3 },
          ]),
        (c) => (c.data.collections.examples.records[0].body.key = "absent"),
        (c) => (c.data.claims.main.claims[0].scope.smarts = "["),
        (c) =>
          (c.data.collections.examples.records[0].structure = {
            source: "beta",
            page: 1,
            rect: [0, 0, 600, 820],
          }),
        (c) =>
          (c.data.collections.examples.fields.find(
            (f) => f.key === "activity",
          ).ref = {
            source: "beta",
            page: 1,
            rect: [0, 0, 595, 843],
          }),
        (c) => (c.data.collections.examples.records[0].refs.examples = [999]),
        (c) => {
          c.data.collections.examples.fields.push({
            key: "related",
            label: "相关记录",
            kind: "link",
          });
          c.data.collections.examples.records[0].related =
            "/sites/fable-patent/examples/999";
        },
      ]) {
        const changed = structuredClone(original);
        mutate(changed);
        await writeFile(path, JSON.stringify(changed));
        await assert.rejects(
          pushUnits(db.pool, store, content, ["sites/fable-patent"]),
        );
        assert.deepEqual(
          (
            await db.pool.query(
              "SELECT content FROM topics WHERE slug='fable-patent'",
            )
          ).rows[0].content,
          original,
        );
      }
      await removeUnit(db.pool, "sites/sample");
      assert.equal(
        (await db.pool.query("SELECT count(*)::int AS n FROM topics")).rows[0]
          .n,
        1,
      );
    } finally {
      await db.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
