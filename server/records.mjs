import { problemField, topicProblems } from "../src/ui/topic/problem.ts";
import { patentRecordFields } from "../src/ui/topic/patent-records.ts";
import { createRecordCodec, RECORD_VERSION } from "../src/contracts/records.ts";
import { predictionField, pathField } from "../src/ui/topic/prediction.ts";
import { topicPredictions } from "../scripts/topic-content.mjs";

export function topicRecordsCodec(content) {
  return createRecordCodec({
    chapterIds: content.chapters.map((c) => c.id),
    quiz: content.quiz ?? [],
    diagnostic: content.placement ?? content.quiz ?? [],
    extras: {
      ...patentRecordFields(content),
      problems: problemField(topicProblems(content)),
      predictions: predictionField(topicPredictions(content)),
      ...(content.paths ? { path: pathField(content.paths) } : {}),
    },
  });
}
function parseNotesRecords(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("阅读记录格式错误");
  const result = {};
  for (const [path, item] of Object.entries(value)) {
    if (
      !/^\/notes\/[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(
        path,
      ) ||
      !item ||
      typeof item !== "object" ||
      !Number.isFinite(item.opened) ||
      item.opened < 0 ||
      typeof item.read !== "boolean" ||
      Object.keys(item).some((key) => !["opened", "read"].includes(key))
    )
      throw new Error("阅读记录格式错误");
    result[path] = { opened: item.opened, read: item.read };
  }
  return result;
}

/** Resolve the current topic contract before reading or accepting a record. */
export async function recordContext(content, slug) {
  if (!slug) return { scope: "notes", codec: null };
  const topic = (await content()).topic(slug);
  return topic
    ? { scope: "sites/" + slug, codec: topicRecordsCodec(topic.content) }
    : null;
}

export async function readRecord(pool, { scope, codec }) {
  const saved = (
    await pool.query(
      "SELECT document, md5(document::text) AS revision FROM learning_records WHERE scope=$1",
      [scope],
    )
  ).rows[0];
  return {
    document:
      saved?.document ??
      (codec ? { version: RECORD_VERSION, ...codec.empty() } : {}),
    revision: saved?.revision ?? "absent",
  };
}

/** Atomic compare-and-set; null means another writer changed the baseline. */
export async function writeRecord(pool, scope, document, revision) {
  const result =
    revision === "absent"
      ? await pool.query(
          "INSERT INTO learning_records(scope,document) VALUES ($1,$2) ON CONFLICT(scope) DO NOTHING RETURNING md5(document::text) AS revision",
          [scope, document],
        )
      : await pool.query(
          "UPDATE learning_records SET document=$2 WHERE scope=$1 AND md5(document::text)=$3 RETURNING md5(document::text) AS revision",
          [scope, document, revision],
        );
  return result.rows[0]?.revision ?? null;
}

/** Rejects when the record store cannot answer. */
export async function recordsReady(pool) {
  await pool.query("SELECT 1");
}

export async function allRecords(pool) {
  const rows = (await pool.query("SELECT scope,document FROM learning_records"))
    .rows;
  return {
    topics: Object.fromEntries(
      rows
        .filter((r) => r.scope.startsWith("sites/"))
        .map((r) => [r.scope.slice(6), r.document]),
    ),
    notes: rows.find((r) => r.scope === "notes")?.document ?? {},
  };
}

export function parseRecord({ codec }, value) {
  return codec
    ? { version: RECORD_VERSION, ...codec.parseRecords(value) }
    : parseNotesRecords(value);
}
