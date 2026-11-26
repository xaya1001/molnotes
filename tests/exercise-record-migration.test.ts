import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { migrateExerciseRecords } from "../scripts/migrate-exercise-records.ts";
import { openRecords } from "../server/web/records.ts";
import { RECORD_VERSION } from "../src/contracts/records.ts";

test("exercise record migration preserves answers and aborts all writes on a conflicting topic", async () => {
  const root = await mkdtemp(join(tmpdir(), "exercise-records-"));
  try {
    const previous = join(root, "before");
    const target = join(root, "after");
    await Promise.all([mkdir(previous), mkdir(target)]);
    const choice = {
      question: "Which sample?",
      options: ["A", "B"],
      answer: 0,
      explanation: "Use the control.",
    };
    const structure = {
      id: "point",
      kind: "atoms",
      question: "Select the atom.",
      molecule: { name: "Sample", smiles: "CC" },
      answer: [1],
      explanation: "Check the reference.",
    };
    const snapshot = (blocks: object[], commit: string) => ({
      format: 1,
      commit,
      topics: ["a", "b"].map((slug) => ({
        slug,
        content: { chapters: [{ id: "chapter", blocks }] },
      })),
    });
    await Promise.all([
      writeFile(
        join(previous, "snapshot.json"),
        JSON.stringify(
          snapshot(
            [
              { ...choice, type: "prediction" },
              { ...structure, type: "prediction" },
            ],
            "previous",
          ),
        ),
      ),
      writeFile(
        join(target, "snapshot.json"),
        JSON.stringify(
          snapshot(
            [
              { ...choice, type: "choice", id: "chapter" },
              { ...structure, type: "structure" },
            ],
            "target",
          ),
        ),
      ),
    ]);
    const database = join(root, "records.sqlite");
    const store = openRecords(database);
    const add = store.prepare(
      "INSERT INTO learning_records(scope,document) VALUES (?,?)",
    );
    const old = {
      version: 1,
      recent: { chapter: "chapter", opened: 1 },
      complete: ["chapter"],
      bookmarks: ["chapter"],
      notes: { chapter: "A note" },
      answers: {},
      diagnostic: {},
      predictions: { chapter: { option: 1 }, point: { selected: [1] } },
    };
    try {
      add.run("sites/a", JSON.stringify(old));
      add.run("sites/b", JSON.stringify({ ...old, answers: { chapter: 0 } }));
      add.run("notes", "{}");
      const stored = store.prepare(
        "SELECT document FROM learning_records WHERE scope = ?",
      );
      const read = (scope: string) =>
        JSON.parse(String(stored.get(scope)?.document));

      await assert.rejects(
        migrateExerciseRecords(database, previous, target, true),
        /sites\/b: Conflicting/,
      );
      assert.deepEqual(read("sites/a"), old);
      store
        .prepare(
          "UPDATE learning_records SET document = ? WHERE scope = 'sites/b'",
        )
        .run(JSON.stringify(old));

      const preview = await migrateExerciseRecords(
        database,
        previous,
        target,
        false,
      );
      assert.deepEqual(preview.answers, { choice: 2, atoms: 2 });
      assert.deepEqual(read("sites/a"), old);
      const result = await migrateExerciseRecords(
        database,
        previous,
        target,
        true,
      );
      assert.equal(result.migrated, 2);
      const { predictions, ...unchanged } = old;
      const expected = {
        ...unchanged,
        version: RECORD_VERSION,
        answers: { chapter: predictions.chapter.option },
        exercises: { point: predictions.point },
        matrices: {},
      };
      assert.deepEqual(read("sites/a"), expected);
      assert.deepEqual(read("sites/b"), expected);
      assert.deepEqual(read("notes"), {});
      assert.equal(
        (await migrateExerciseRecords(database, previous, target, true))
          .current,
        2,
      );
    } finally {
      store.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
