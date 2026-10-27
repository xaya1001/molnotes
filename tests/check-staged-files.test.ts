import assert from "node:assert/strict";
import test from "node:test";

import { findForbiddenPaths } from "../scripts/check-staged-files.ts";

test("source assets are allowed while runtime files and credentials are blocked", () => {
  assert.deepEqual(
    findForbiddenPaths([
      "sites/demo/static/compound-1.webp",
      "sites/demo/.env.example",
      "sites/demo/.env.local",
      "dist/index.html",
      "logs/site.log",
      "sites/demo/secrets/local.txt",
      "toolbox/recipes/pdf-research.md",
      "certs/site.pem",
    ]),
    [
      "sites/demo/.env.local",
      "dist/index.html",
      "logs/site.log",
      "sites/demo/secrets/local.txt",
      "certs/site.pem",
    ],
  );
});
