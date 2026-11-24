import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_CONTENT_DIR = resolve(
  import.meta.dirname,
  "..",
  "private",
  "content",
);

/** Resolve a setting from `<name>` or the file named by `<name>_FILE`, without including its value in errors. */
export function setting(name: string): string {
  if (process.env[name]) return process.env[name].trim();
  const path = process.env[`${name}_FILE`];
  if (!path) {
    if (name === "MOLNOTES_CONTENT_DIR") return DEFAULT_CONTENT_DIR;
    throw new Error(`${name} is not configured`);
  }
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    throw new Error(`${name}: configuration file cannot be read`);
  }
}
