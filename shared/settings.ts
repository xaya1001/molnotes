import { resolve } from "node:path";
import { environmentSetting } from "./environment-setting.ts";

const DEFAULT_CONTENT_DIR = resolve(
  import.meta.dirname,
  "..",
  "private",
  "content",
);

/** Resolve a setting from `<name>` or the file named by `<name>_FILE`, without including its value in errors. */
export function setting(name: string): string {
  const value = environmentSetting(name);
  if (value !== undefined) return value;
  if (name === "MOLNOTES_CONTENT_DIR") return DEFAULT_CONTENT_DIR;
  throw new Error(`${name} is not configured`);
}
