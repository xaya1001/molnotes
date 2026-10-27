import { reactive, ref } from "vue";
import { recordSync } from "../ui/record-sync.ts";
import { readPosition, savePosition } from "../ui/reading-position";
interface Reading {
  opened: number;
  scroll: number;
  section: string;
  read: boolean;
}
export const storageError = ref("");
export const storageConflict = ref(false);
export const reading = reactive<Record<string, Reading>>({});
const sync =
  recordSync<Record<string, Omit<Reading, "scroll" | "section">>>(
    "/api/records/notes",
  );
const snapshot = () =>
  Object.fromEntries(
    Object.entries(reading).map(([path, { opened, read }]) => [
      path,
      { opened, read },
    ]),
  );
let loaded = false;
let dirty = false;
let saving = false;
export async function loadReading() {
  try {
    const value = await sync.load();
    for (const [path, item] of Object.entries(value))
      reading[path] = { ...item, ...readPosition(path) };
    loaded = true;
    storageError.value = "";
  } catch {
    storageError.value = "阅读记录读取失败，请重试。";
  }
}
export async function retryReading(resolve = storageConflict.value) {
  if (!loaded) {
    await loadReading();
    return;
  }
  if (saving) return;
  saving = true;
  try {
    while (dirty) {
      dirty = false;
      try {
        const sent = snapshot();
        const merged = await sync.save(sent, resolve, snapshot);
        for (const path of Object.keys(reading))
          if (!(path in merged)) delete reading[path];
        for (const [path, value] of Object.entries(merged))
          reading[path] = { ...readPosition(path), ...reading[path], ...value };
        if (sync.conflicted)
          throw new Error(
            "conflict: 保存期间同一项记录发生变化，请核对本页修改后再保存。",
          );
        storageConflict.value = false;
        storageError.value = "";
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
export function saveReading(path: string, patch: Partial<Reading>) {
  if (!loaded && (patch.opened !== undefined || patch.read !== undefined)) {
    storageError.value = "阅读记录读取失败，请重试。";
    return;
  }
  reading[path] = {
    ...(reading[path] ?? { opened: 0, scroll: 0, section: "", read: false }),
    ...patch,
  };
  if (patch.scroll !== undefined) savePosition(path, reading[path]);
  if (patch.opened !== undefined || patch.read !== undefined) {
    dirty = true;
    void retryReading(false);
  }
}
