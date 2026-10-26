import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { requireBrowserBuild } from "./helpers/browser-build.mjs";

test("browser setup rejects missing build output with an actionable command", async () => {
  const directory = await mkdtemp(join(tmpdir(), "il-browser-build-"));
  try {
    await assert.rejects(
      requireBrowserBuild(join(directory, "missing")),
      /Run npm run build before npm run test:e2e/,
    );
    await assert.rejects(
      requireBrowserBuild(directory),
      /Browser build missing/,
    );
    await writeFile(join(directory, "index.html"), "<!doctype html>");
    await requireBrowserBuild(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
