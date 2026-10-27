import { isObject, isFiniteNumber } from "../../shared/json.ts";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { problemField, topicProblems } from "../../src/ui/topic/problem.ts";
import { patentRecordFields } from "../../src/ui/topic/patent-records.ts";
import {
  createRecordCodec,
  RECORD_VERSION,
} from "../../src/contracts/records.ts";
import { predictionField, pathField } from "../../src/ui/topic/prediction.ts";
import { topicPredictions } from "../../shared/topic-content.ts";
import type { TopicContent } from "../../src/ui/topic/content.ts";
import type { LoadedSnapshot } from "./content-cache.ts";

export type RecordStore = DatabaseSync;
type RecordCodec = ReturnType<typeof topicRecordsCodec>;
/** Where a record lives and the contract it is checked against; notes records have no codec. */
export interface RecordContext {
  scope: string;
  codec: RecordCodec | null;
}
interface NotesRecord {
  opened: number;
  read: boolean;
}

export function topicRecordsCodec(content: TopicContent) {
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
function parseNotesRecords(value: unknown) {
  if (!isObject(value)) throw new Error("阅读记录格式错误");
  const result: Record<string, NotesRecord> = {};
  // Each entry is checked field by field below.
  for (const [path, item] of Object.entries<unknown>(value)) {
    if (
      !/^\/notes\/[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(
        path,
      ) ||
      !isObject(item) ||
      !isFiniteNumber(item.opened) ||
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
export async function recordContext(
  content: () => Promise<LoadedSnapshot>,
  slug: string | undefined,
): Promise<RecordContext | null> {
  if (!slug) return { scope: "notes", codec: null };
  const topic = (await content()).topic(slug);
  return topic
    ? { scope: "sites/" + slug, codec: topicRecordsCodec(topic.content) }
    : null;
}

/**
 * Opens the record store at `file`, creating its table when the file is new.
 * The parent directory must exist. A revision is the MD5 of the stored text.
 */
export function openRecords(file: string): RecordStore {
  const records = new DatabaseSync(file);
  records.exec("PRAGMA journal_mode=WAL");
  records.function("md5", { deterministic: true }, (text) =>
    createHash("md5")
      .update(text as string)
      .digest("hex"),
  );
  records.exec(
    "CREATE TABLE IF NOT EXISTS learning_records (scope TEXT PRIMARY KEY, document TEXT NOT NULL) STRICT",
  );
  return records;
}

interface SavedRecord {
  document: string;
  revision: string;
}

export function readRecord(
  records: RecordStore,
  { scope, codec }: RecordContext,
) {
  const saved = records
    .prepare(
      "SELECT document, md5(document) AS revision FROM learning_records WHERE scope=?",
    )
    .get(scope) as SavedRecord | undefined;
  return {
    document: saved
      ? JSON.parse(saved.document)
      : codec
        ? { version: RECORD_VERSION, ...codec.empty() }
        : {},
    revision: saved?.revision ?? "absent",
  };
}

/** Atomic compare-and-set; null means another writer changed the baseline. */
export function writeRecord(
  records: RecordStore,
  scope: string,
  document: unknown,
  revision: string,
): string | null {
  const text = JSON.stringify(document);
  const saved = (
    revision === "absent"
      ? records
          .prepare(
            "INSERT INTO learning_records(scope,document) VALUES (?,?) ON CONFLICT(scope) DO NOTHING RETURNING md5(document) AS revision",
          )
          .get(scope, text)
      : records
          .prepare(
            "UPDATE learning_records SET document=? WHERE scope=? AND md5(document)=? RETURNING md5(document) AS revision",
          )
          .get(text, scope, revision)
  ) as Pick<SavedRecord, "revision"> | undefined;
  return saved?.revision ?? null;
}

/** Throws when the record store cannot answer. */
export function recordsReady(records: RecordStore) {
  records.prepare("SELECT 1").get();
}

export function allRecords(records: RecordStore) {
  const rows = (
    records.prepare("SELECT scope,document FROM learning_records").all() as {
      scope: string;
      document: string;
    }[]
  ).map((r) => ({ scope: r.scope, document: JSON.parse(r.document) }));
  return {
    topics: Object.fromEntries(
      rows
        .filter((r) => r.scope.startsWith("sites/"))
        .map((r) => [r.scope.slice(6), r.document]),
    ),
    notes: rows.find((r) => r.scope === "notes")?.document ?? {},
  };
}

export function parseRecord({ codec }: RecordContext, value: unknown) {
  return codec
    ? { version: RECORD_VERSION, ...codec.parseRecords(value) }
    : parseNotesRecords(value);
}
