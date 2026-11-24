import { readFileSync } from "node:fs";

/** Read a setting from the environment or its configured file. */
export function environmentSetting(name: string) {
  if (process.env[name]) return process.env[name].trim();
  const path = process.env[`${name}_FILE`];
  if (!path) return;
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    throw new Error(`${name}: configuration file cannot be read`);
  }
}
