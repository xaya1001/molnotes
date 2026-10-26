/** Records every topic keeps; a topic adds its own fields through `extras`. */
export interface TopicRecordsBase {
  /** Last opened chapter and time, using the notebook opened timestamp convention. */
  recent: { chapter: string; opened: number } | null;
  complete: string[];
  bookmarks: string[];
  notes: Record<string, string>;
  /** Chosen option per quiz question id. */
  answers: Record<string, number>;
  /** Chosen option per question id of the entry self-test, when the topic has one. */
  diagnostic: Record<string, number>;
}

/** Validates one persisted topic-specific field. */
export interface RecordField<T> {
  empty(): T;
  parse(value: unknown): T;
}

export type RecordFields<E> = { [K in keyof E]: RecordField<E[K]> };

export const RECORD_VERSION = 1;
const MAX_NOTE_LENGTH = 50000;

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A field holding one chosen option per quiz question id. */
function quizAnswerField(
  quiz: readonly { id: string; options: readonly unknown[] }[],
): RecordField<Record<string, number>> {
  return {
    empty: () => ({}),
    parse(value) {
      if (value === undefined) return {};
      if (!isObject(value)) throw new Error("作答记录格式错误");
      const next: Record<string, number> = {};
      for (const [id, option] of Object.entries(value)) {
        const question = quiz.find((item) => item.id === id);
        if (
          !question ||
          typeof option !== "number" ||
          !Number.isInteger(option) ||
          option < 0 ||
          option >= question.options.length
        )
          throw new Error("作答选项无效");
        next[id] = option;
      }
      return next;
    },
  };
}

/** Shared parser for the browser and the server record boundary. */
export function createRecordCodec<E extends object>({
  chapterIds,
  quiz,
  diagnostic = quiz,
  extras,
}: {
  chapterIds: readonly string[];
  quiz: readonly { id: string; options: readonly unknown[] }[];
  /** Questions of the entry self-test when they are not part of `quiz`. */
  diagnostic?: readonly { id: string; options: readonly unknown[] }[];
  extras: RecordFields<E>;
}) {
  const chapters = new Set(chapterIds);
  const answers = quizAnswerField(quiz);
  const diagnosticAnswers = quizAnswerField(diagnostic);
  const fields = Object.entries(extras) as [
    keyof E & string,
    RecordField<unknown>,
  ][];

  function chapterList(value: unknown) {
    if (
      !Array.isArray(value) ||
      !value.every((id) => typeof id === "string" && chapters.has(id))
    )
      throw new Error("章节记录格式错误");
    return [...new Set<string>(value)];
  }

  function empty(): TopicRecordsBase & E {
    const base: TopicRecordsBase = {
      recent: null,
      complete: [],
      bookmarks: [],
      notes: {},
      answers: {},
      diagnostic: {},
    };
    const extra = Object.fromEntries(
      fields.map(([key, field]) => [key, field.empty()]),
    ) as E;
    return { ...base, ...extra };
  }

  function parseRecords(value: unknown): TopicRecordsBase & E {
    if (
      !isObject(value) ||
      value.version !== RECORD_VERSION ||
      !isObject(value.notes)
    )
      throw new Error("记录版本或内容不受支持");
    const next = empty();
    if (value.recent !== undefined && value.recent !== null) {
      const recent = value.recent;
      if (
        !isObject(recent) ||
        typeof recent.chapter !== "string" ||
        !chapters.has(recent.chapter) ||
        typeof recent.opened !== "number" ||
        !Number.isFinite(recent.opened) ||
        recent.opened < 0
      )
        throw new Error("最近阅读记录格式错误");
      next.recent = { chapter: recent.chapter, opened: recent.opened };
    }
    next.complete = chapterList(value.complete);
    next.bookmarks = chapterList(value.bookmarks);
    for (const [id, note] of Object.entries(value.notes)) {
      if (
        !chapters.has(id) ||
        typeof note !== "string" ||
        note.length > MAX_NOTE_LENGTH
      )
        throw new Error("笔记格式错误");
      next.notes[id] = note;
    }
    next.answers = answers.parse(value.answers ?? {});
    next.diagnostic = diagnosticAnswers.parse(value.diagnostic);
    for (const [key, field] of fields)
      (next as Record<string, unknown>)[key] = field.parse(value[key]);
    return next;
  }

  return { empty, parseRecords };
}
