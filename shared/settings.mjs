import { readFileSync } from "node:fs";

/** Resolve a setting from `<name>` or the file named by `<name>_FILE`, without including its value in errors. */
export function setting(name) {
  if (process.env[name]) return process.env[name].trim();
  const path = process.env[`${name}_FILE`];
  if (!path) throw new Error(`${name} is not configured`);
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    throw new Error(`${name}: configuration file cannot be read`);
  }
}
