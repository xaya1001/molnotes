import { access } from "node:fs/promises";
import { join, resolve } from "node:path";

export async function requireBrowserBuild(directory = resolve("dist")) {
  try {
    await access(join(directory, "index.html"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    throw new Error(
      `Browser build missing at ${directory}. Run npm run build before npm run test:e2e.`,
    );
  }
}
