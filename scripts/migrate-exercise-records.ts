import { isDeepStrictEqual } from "node:util";
import { readFile, realpath } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { isObject, RECORD_VERSION } from "../src/contracts/records.ts";
import { topicRecordsCodec } from "../server/web/records.ts";
import { topicExercises } from "../shared/topic-content.ts";
import { isTextChoice } from "../src/ui/topic/exercise.ts";
import type { Snapshot } from "../shared/snapshot.ts";
import type { TopicContent } from "../src/ui/topic/content.ts";

const previousVersion = 1;

type OldTopic = {
  slug: string;
  content: { chapters: { id: string; blocks: unknown[] }[] };
};

async function snapshotAt<T extends { slug: string }>(directory: string) {
  const snapshot: Pick<Snapshot, "format" | "commit"> & { topics: T[] } =
    JSON.parse(await readFile(join(directory, "snapshot.json"), "utf8"));
  if (snapshot.format !== 1 || !Array.isArray(snapshot.topics))
    throw new Error("Unsupported content snapshot");
  return snapshot;
}

function previousExercises(topic: OldTopic) {
  const entries = new Map<string, string>();
  for (const chapter of topic.content.chapters) {
    for (const block of chapter.blocks) {
      if (!isObject(block)) continue;
      if (block.type !== "prediction" && block.type !== "matrix") continue;
      const id = block.id ?? chapter.id;
      if (typeof id !== "string" || entries.has(id))
        throw new Error("Invalid exercise identity in source snapshot");
      const kind =
        block.type === "matrix" ? "matrix" : (block.kind ?? "choice");
      if (typeof kind !== "string")
        throw new Error("Invalid source exercise kind");
      entries.set(id, kind);
    }
  }
  return entries;
}

function targetKind(
  exercise: ReturnType<typeof topicExercises>[number]["exercise"],
) {
  return exercise.kind ?? exercise.type;
}

function migrateTopic(
  document: Record<string, unknown>,
  previous: OldTopic,
  target: TopicContent,
  totals: Record<string, number>,
) {
  const source = previousExercises(previous);
  const entries = new Map(
    topicExercises(target).map(({ id, exercise }) => [id, exercise]),
  );
  const { predictions = {}, ...rest } = document;
  if (!isObject(predictions) || !isObject(rest.answers))
    throw new Error("Invalid source exercise record");
  const answers = { ...rest.answers };
  const exercises: Record<string, unknown> = {};
  const matrices: Record<string, unknown> = {};
  for (const [id, answer] of Object.entries(predictions)) {
    const exercise = entries.get(id);
    if (!exercise || source.get(id) !== targetKind(exercise))
      throw new Error(`Unknown or changed exercise ${id}`);
    if (exercise.type === "matrix") matrices[id] = answer;
    else if (exercise.type === "quiz")
      throw new Error(`Invalid exercise ${id}`);
    else if (isTextChoice(exercise)) {
      if (
        !isObject(answer) ||
        Object.keys(answer).length !== 1 ||
        Object.hasOwn(answers, id)
      )
        throw new Error(`Conflicting or invalid choice answer ${id}`);
      answers[id] = answer.option;
    } else exercises[id] = answer;
    const kind = targetKind(exercise);
    totals[kind] = (totals[kind] ?? 0) + 1;
  }
  const next = {
    ...rest,
    version: RECORD_VERSION,
    answers,
    exercises,
    matrices,
  };
  const parsed = topicRecordsCodec(target).parseRecords(next);
  if (
    !isDeepStrictEqual(parsed.answers, answers) ||
    !isDeepStrictEqual(parsed.exercises, exercises) ||
    !isDeepStrictEqual(parsed.matrices, matrices)
  )
    throw new Error("Target contract changes a stored answer");
  return next;
}

export async function migrateExerciseRecords(
  database: string,
  previousDirectory: string,
  targetDirectory: string,
  apply: boolean,
) {
  const [previous, target] = await Promise.all([
    snapshotAt<OldTopic>(previousDirectory),
    snapshotAt<Snapshot["topics"][number]>(targetDirectory),
  ]);
  const sourceTopics = new Map(
    previous.topics.map((topic) => [topic.slug, topic]),
  );
  const targetTopics = new Map(
    target.topics.map((topic) => [topic.slug, topic.content]),
  );
  const store = new DatabaseSync(await realpath(database), {
    readOnly: !apply,
  });
  const totals: Record<string, number> = {};
  let migrated = 0;
  let current = 0;
  try {
    store.exec(apply ? "BEGIN IMMEDIATE" : "BEGIN");
    try {
      const rows = store
        .prepare(
          "SELECT scope, document FROM learning_records WHERE scope LIKE 'sites/%' ORDER BY scope",
        )
        .all();
      const update =
        apply &&
        store.prepare(
          "UPDATE learning_records SET document = ? WHERE scope = ?",
        );
      for (const row of rows) {
        const scope = String(row.scope);
        try {
          const document: unknown = JSON.parse(String(row.document));
          const slug = scope.slice("sites/".length);
          const before = sourceTopics.get(slug);
          const after = targetTopics.get(slug);
          if (!isObject(document) || !before || !after)
            throw new Error(
              "Topic or record is missing from the migration input",
            );
          if (document.version === RECORD_VERSION) {
            topicRecordsCodec(after).parseRecords(document);
            current++;
          } else if (document.version === previousVersion) {
            const next = migrateTopic(document, before, after, totals);
            if (update) update.run(JSON.stringify(next), scope);
            migrated++;
          } else throw new Error("Unsupported record version");
        } catch (error) {
          throw new Error(`${scope}: ${(error as Error).message}`, {
            cause: error,
          });
        }
      }
      store.exec("COMMIT");
    } catch (error) {
      store.exec("ROLLBACK");
      throw error;
    }
  } finally {
    store.close();
  }
  return {
    applied: apply,
    previous: previous.commit,
    target: target.commit,
    migrated,
    current,
    answers: totals,
  };
}

if (import.meta.main) {
  const [mode, database, previous, target, ...extra] = process.argv.slice(2);
  if (
    !["--dry-run", "--apply"].includes(mode) ||
    !database ||
    !previous ||
    !target ||
    extra.length
  ) {
    console.error(
      "Usage: node scripts/migrate-exercise-records.ts --dry-run|--apply <sqlite> <previous-snapshot> <target-snapshot>",
    );
    process.exitCode = 2;
  } else {
    try {
      const result = await migrateExerciseRecords(
        database,
        previous,
        target,
        mode === "--apply",
      );
      console.log(JSON.stringify(result));
    } catch (error) {
      console.error((error as Error).message);
      process.exitCode = 1;
    }
  }
}
