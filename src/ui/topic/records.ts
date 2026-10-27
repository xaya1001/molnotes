import { recordSync } from "../record-sync.ts";
import { reactive, ref, watch } from "vue";

import {
  createRecordCodec,
  RECORD_VERSION,
  type TopicRecordsBase,
  type RecordFields,
} from "../../contracts/records.ts";

export interface TopicRecordsStore<E> {
  records: TopicRecordsBase & E;
  /** Reader-facing load or save failure. */
  storageError: { value: string };
  storageConflict: { value: boolean };
  toggle(kind: "complete" | "bookmarks", id: string): void;
  parseRecords(value: unknown): TopicRecordsBase & E;
  /** Initial record request; failure is exposed through storageError. */
  ready: Promise<void>;
  loaded: { value: boolean };
  retry(): Promise<void>;
}

export function createTopicRecords<E extends object>({
  slug,
  chapterIds,
  quiz,
  diagnostic = quiz,
  extras,
}: {
  slug: string;
  chapterIds: readonly string[];
  quiz: readonly { id: string; options: readonly unknown[] }[];
  /** Questions of the entry self-test when they are not part of `quiz`. */
  diagnostic?: readonly { id: string; options: readonly unknown[] }[];
  extras: RecordFields<E>;
}): TopicRecordsStore<E> {
  const { empty, parseRecords } = createRecordCodec({
    chapterIds,
    quiz,
    diagnostic,
    extras,
  });
  const records = reactive(empty()) as TopicRecordsBase & E;
  const storageError = ref("");
  const loaded = ref(false);
  const storageConflict = ref(false);
  let dirty = false;
  let saving = false;
  let applying = false;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const endpoint = `/api/records/topics/${encodeURIComponent(slug)}`;
  const sync = recordSync<Record<string, unknown>>(endpoint, parseRecords, {
    getItem: (key) => sessionStorage.getItem(key),
    setItem: (key, value) => sessionStorage.setItem(key, value),
    removeItem: (key) => sessionStorage.removeItem(key),
  });
  const snapshot = () => ({
    version: RECORD_VERSION,
    ...JSON.parse(JSON.stringify(records)),
  });
  let draftError = false;
  async function save(resolve = false) {
    if (!loaded.value || saving) return;
    saving = true;
    try {
      while (dirty && saveTimer === undefined) {
        dirty = false;
        const document = snapshot();
        try {
          const merged = await sync.save(document, resolve, snapshot);
          const parsed = parseRecords(merged);
          applying = true;
          Object.assign(records, parsed);
          applying = false;
          if (sync.conflicted)
            throw new Error(
              "conflict: 保存期间同一项记录发生变化，请核对本页修改后再保存。",
            );
          storageConflict.value = false;
          storageError.value = "";
          draftError = false;
        } catch (error) {
          dirty = true;
          storageConflict.value =
            error instanceof Error && error.message.startsWith("conflict:");
          storageError.value =
            error instanceof Error && error.message.startsWith("conflict:")
              ? error.message.slice(10)
              : "未保存，请重试。当前修改仍保留在页面中。";
          break;
        }
      }
    } finally {
      saving = false;
    }
  }
  async function load() {
    try {
      const value = await sync.load();
      const parsed = parseRecords(value);
      applying = true;
      Object.assign(records, parsed);
      applying = false;
      loaded.value = true;
      storageConflict.value = sync.conflicted;
      storageError.value = sync.conflicted
        ? "同一项记录已在其他页面修改。已恢复本页输入，请核对后再保存。"
        : "";
      if (sync.pending) {
        dirty = true;
        if (!sync.conflicted) void save();
      }
    } catch {
      storageError.value = "学习记录读取失败，请重试后继续记录。";
    }
  }
  const ready = load();
  watch(
    records,
    () => {
      if (!applying) {
        dirty = true;
        try {
          sync.stage(snapshot());
          draftError = false;
        } catch {
          draftError = true;
          storageError.value = "未保存，请重试。请勿关闭本页。";
        }
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
          saveTimer = undefined;
          void save();
        }, 500);
      }
    },
    { deep: true, flush: "sync" },
  );

  window.addEventListener("pagehide", () => {
    clearTimeout(saveTimer);
    saveTimer = undefined;
    void save();
  });
  window.addEventListener("beforeunload", (event) => {
    if (draftError) {
      event.preventDefault();
      event.returnValue = "";
    }
  });

  return {
    records,
    storageError,
    storageConflict,
    toggle(kind, id) {
      const index = records[kind].indexOf(id);
      if (index < 0) records[kind].push(id);
      else records[kind].splice(index, 1);
    },
    parseRecords,
    ready,
    loaded,
    async retry() {
      if (!loaded.value) await load();
      else {
        dirty = true;
        clearTimeout(saveTimer);
        saveTimer = undefined;
        await save(storageConflict.value);
      }
    },
  };
}
