import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
export function planChangedFiles(paths) {
  return {
    mode: paths.every(
      (path) =>
        (path.endsWith(".md") && !path.startsWith("tests/fixtures/")) ||
        path.startsWith(".codex/") ||
        ["scripts/ci-plan.mjs", "tests/ci-plan.test.mjs"].includes(path),
    )
      ? "docs"
      : "full",
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const paths = readFileSync(process.argv[2], "utf8")
    .split("\0")
    .filter(Boolean);
  console.log(`mode=${planChangedFiles(paths).mode}`);
}
