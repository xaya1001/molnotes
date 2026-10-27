import { shallowReactive } from "vue";
import { predictionField, predictionMistaken } from "./topic/prediction";
import { problemField, type ProblemAnswer } from "./topic/problem";
import type { PredictionAnswer } from "./topic/content";
import { api } from "./api";
import { topicBase, type CatalogSite } from "./catalog";
import type { IndexedTopic } from "../../shared/topic-index.ts";
import { isObject } from "../contracts/records";

/**
 * `none`: nothing recorded yet; `outdated`: saved before the unified record
 * format (no `diagnostic`, or another version) and updated the next time the
 * topic opens; `unreadable`: not JSON, or a field of the wrong type.
 */
export type SiteRecordState = "none" | "ok" | "outdated" | "unreadable";

/** One topic's records, limited to chapters and questions the topic has now. */
export interface SiteTopicRecords {
  slug: string;
  state: SiteRecordState;
  complete: string[];
  bookmarks: string[];
  notes: Record<string, string>;
  /** Chosen option per review question id. */
  answers: Record<string, number>;
  /** Wrong quiz and prediction answers and open problems rated unknown. */
  mistakes: string[];
  predictions: Record<string, PredictionAnswer>;
  problems: Record<string, ProblemAnswer>;
  predictionMistakes: string[];
  problemMistakes: string[];
}

export interface SiteRecords {
  topics: SiteTopicRecords[];
  /** Empty when the browser lets the page read records; otherwise why not. */
  storageError: string;
}

const snapshot: {
  topics: Record<string, unknown>;
  notes: Record<string, { opened: number; read: boolean }>;
} = shallowReactive({
  topics: {},
  notes: {},
});
let readError = "";
let loading: Promise<void> | undefined;
export function loadSiteRecords() {
  return (loading ??= fetchSiteRecords());
}
async function fetchSiteRecords() {
  try {
    Object.assign(snapshot, await api<typeof snapshot>("/api/records"));
    readError = "";
  } catch {
    loading = undefined;
    readError = "学习记录读取失败，请刷新重试。";
  }
}

function isStringList(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function empty(slug: string, state: SiteRecordState): SiteTopicRecords {
  return {
    slug,
    state,
    complete: [],
    bookmarks: [],
    notes: {},
    answers: {},
    mistakes: [],
    predictions: {},
    problems: {},
    predictionMistakes: [],
    problemMistakes: [],
  };
}

function parse(topic: IndexedTopic, raw: string | null): SiteTopicRecords {
  if (raw === null) return empty(topic.slug, "none");
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return empty(topic.slug, "unreadable");
  }
  if (!isObject(value)) return empty(topic.slug, "unreadable");
  if (value.version !== 1 || !isObject(value.diagnostic))
    return empty(topic.slug, "outdated");
  const { complete, bookmarks, notes, answers } = value;
  if (
    !isStringList(complete) ||
    !isStringList(bookmarks) ||
    !isObject(notes) ||
    !Object.values(notes).every((note) => typeof note === "string") ||
    !isObject(answers) ||
    !Object.values(answers).every((option) => Number.isInteger(option))
  )
    return empty(topic.slug, "unreadable");

  const chapters = new Set(topic.chapters.map((chapter) => chapter.id));
  const records = empty(topic.slug, "ok");
  records.complete = [...new Set(complete)].filter((id) => chapters.has(id));
  records.bookmarks = [...new Set(bookmarks)].filter((id) => chapters.has(id));
  for (const [id, note] of Object.entries(notes as Record<string, string>))
    if (chapters.has(id) && note.trim()) records.notes[id] = note;
  for (const [id, correct] of Object.entries(topic.answerKey)) {
    const option = (answers as Record<string, number>)[id];
    if (option === undefined) continue;
    records.answers[id] = option;
    if (option !== correct) records.mistakes.push(id);
  }
  try {
    if (value.predictions !== undefined && !isObject(value.predictions))
      return empty(topic.slug, "unreadable");
    const predictions = value.predictions;
    records.predictions = predictionField(topic.predictions).parse(
      predictions === undefined
        ? undefined
        : Object.fromEntries(
            topic.predictions
              .filter(({ id }) => predictions[id] !== undefined)
              .map(({ id }) => [id, predictions[id]]),
          ),
    );
    records.problems = problemField(topic.problems).parse(value.problems);
  } catch {
    return empty(topic.slug, "unreadable");
  }
  records.predictionMistakes = topic.predictions
    .filter(({ id, prediction }) =>
      predictionMistaken(prediction, records.predictions[id]),
    )
    .map(({ id }) => id);
  records.problemMistakes = topic.problems
    .filter(({ id }) => records.problems[id]?.rating === "unknown")
    .map(({ id }) => id);
  records.mistakes.push(
    ...records.predictionMistakes,
    ...records.problemMistakes,
  );
  const recorded =
    records.complete.length ||
    records.bookmarks.length ||
    Object.keys(records.notes).length ||
    Object.keys(records.answers).length ||
    Object.keys(records.predictions).length ||
    Object.keys(records.problems).length;
  return recorded ? records : empty(topic.slug, "none");
}

/**
 * Every topic's API records, read without
 * writing. Topics that saved nothing for their current chapters and
 * questions come back as `none`.
 */
export function readSiteRecords(topics: readonly IndexedTopic[]): SiteRecords {
  return {
    topics: topics.map((topic) =>
      parse(
        topic,
        snapshot.topics[topic.slug] === undefined
          ? null
          : JSON.stringify(snapshot.topics[topic.slug]),
      ),
    ),
    storageError: readError,
  };
}

/** Opened time and read mark per note path, as the notebook saved them. */
export function readNotesRecords() {
  return snapshot.notes;
}

export async function exportSiteRecords(): Promise<string> {
  const data = await api<typeof snapshot>("/api/records");
  return JSON.stringify(
    {
      format: "molnotes/all-records",
      exportedAt: new Date().toISOString(),
      ...data,
    },
    null,
    2,
  );
}

/** Current chapter IDs are the shared denominator for directory and shelf progress. */
export function chapterProgress(
  chapterIds: readonly string[],
  complete: readonly string[],
) {
  const read = new Set(complete);
  return {
    read: chapterIds.filter((id) => read.has(id)).length,
    total: chapterIds.length,
  };
}

export function readChapterProgress(site: CatalogSite) {
  const value = snapshot.topics[site.slug];
  if (readError)
    return { ...chapterProgress(site.chapterIds, []), error: readError };
  if (value === undefined)
    return { ...chapterProgress(site.chapterIds, []), error: "" };
  if (!isObject(value) || !isStringList(value.complete))
    return { ...chapterProgress(site.chapterIds, []), error: "记录无法读取" };
  if (value.version !== 1 || !isObject(value.diagnostic))
    return {
      ...chapterProgress(site.chapterIds, []),
      error: "记录是旧格式，请打开专题更新",
    };
  return { ...chapterProgress(site.chapterIds, value.complete), error: "" };
}

/** Last opened chapter of the section, restricted to the current catalog/index. */
export function sectionHref(
  section: "practice" | "cases",
  sites: readonly CatalogSite[],
) {
  const candidates = sites.filter(
    (site) => (site.group === "练习") === (section === "practice"),
  );
  let latest = 0;
  let href = candidates[0] ? topicBase(candidates[0]) : undefined;
  for (const site of candidates) {
    const value = snapshot.topics[site.slug];
    if (!isObject(value) || !isObject(value.recent)) continue;
    const { chapter, opened } = value.recent;
    const target =
      typeof chapter === "string" ? site.chapterPaths[chapter] : undefined;
    if (
      target &&
      typeof opened === "number" &&
      Number.isFinite(opened) &&
      opened > latest
    ) {
      latest = opened;
      href = topicBase(site) + target.slice(1);
    }
  }
  return href;
}

export function updateTopicSnapshot(slug: string, value: unknown) {
  snapshot.topics = { ...snapshot.topics, [slug]: value };
}
