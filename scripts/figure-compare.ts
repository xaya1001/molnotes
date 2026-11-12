import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isObject } from "../shared/json.ts";
import type {
  FigureObservation,
  FigureObservationSet,
} from "../shared/chemical-library/geometry.ts";
import {
  isFigurePaint,
  isFigureDiagnostic,
} from "../src/ui/library/geometry-contract.ts";
import { compareFigureGeometry } from "../src/ui/library/geometry-compare.ts";

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const point = (value: unknown) =>
  isObject(value) && finite(value.x) && finite(value.y);
const box = (value: unknown) =>
  point(value) &&
  isObject(value) &&
  finite(value.width) &&
  finite(value.height);
const strings = (value: unknown): value is Record<string, string> =>
  isObject(value) &&
  Object.values(value).every((item) => typeof item === "string");
function observation(value: unknown): value is FigureObservation {
  return (
    isObject(value) &&
    finite(value.width) &&
    finite(value.height) &&
    finite(value.minimumScale) &&
    isObject(value.atoms) &&
    Object.values(value.atoms).every(point) &&
    Array.isArray(value.elements) &&
    value.elements.every(
      (element) =>
        isObject(element) &&
        typeof element.key === "string" &&
        strings(element.ids) &&
        box(element.bounds) &&
        (element.path === undefined || typeof element.path === "string") &&
        (element.points === undefined ||
          (Array.isArray(element.points) && element.points.every(point))) &&
        isFigurePaint(element.paint),
    ) &&
    Array.isArray(value.diagnostics) &&
    value.diagnostics.every(isFigureDiagnostic)
  );
}

/** Observation files are an external comparison boundary, not trusted casts. */
export async function readObservationSet(
  file: string,
): Promise<FigureObservationSet> {
  const value: unknown = JSON.parse(await readFile(file, "utf8"));
  if (!isObject(value) || !isObject(value.views) || !strings(value.failures))
    throw new Error(`${file}: expected views and failures`);
  const views: FigureObservationSet["views"] = {};
  const failures: FigureObservationSet["failures"] = {};
  for (const [key, item] of Object.entries(value.views)) {
    if (
      !observation(item) ||
      new Set(item.elements.map((element) => element.key)).size !==
        item.elements.length
    )
      throw new Error(`${file}: invalid observation ${key}`);
    views[key] = item;
  }
  for (const [key, item] of Object.entries(value.failures)) {
    if (typeof item !== "string")
      throw new Error(`${file}: invalid failure ${key}`);
    failures[key] = item;
  }
  return { views, failures };
}

export function compareObservationSets(
  before: FigureObservationSet,
  after: FigureObservationSet,
) {
  const keys = [
    ...new Set([
      ...Object.keys(before.views),
      ...Object.keys(after.views),
      ...Object.keys(before.failures),
      ...Object.keys(after.failures),
    ]),
  ];
  const views = keys.map((key) => {
    const prior = before.views[key],
      current = after.views[key];
    return {
      key,
      comparison:
        prior && current ? compareFigureGeometry(prior, current) : undefined,
      unmatched: prior && current ? undefined : !prior ? "before" : "after",
      beforeError: before.failures[key],
      afterError: after.failures[key],
    };
  });
  const magnitude = (row: (typeof views)[number]) =>
    row.comparison
      ? Math.max(
          row.comparison.maximumBoundsDelta,
          row.comparison.maximumTraceDelta,
          ...row.comparison.atoms.map((atom) => atom.delta ?? 0),
          ...Object.values(row.comparison.canvas).map(Math.abs),
        )
      : Infinity;
  views.sort(
    (a, b) => magnitude(b) - magnitude(a) || a.key.localeCompare(b.key),
  );
  const changed = views.filter(
    (row) => !row.comparison?.equal || row.beforeError || row.afterError,
  );
  return {
    total: keys.length,
    unchanged: views.length - changed.length,
    changed,
  };
}

async function main(args: string[]) {
  const [command] = args;
  const option = (flag: string) => {
    const index = args.indexOf(flag);
    return index === -1 ? undefined : args[index + 1];
  };
  const out = option("--out");
  if (!out) throw new Error("figure:compare requires --out <file.json>");
  let result: unknown;
  if (command === "compare") {
    const before = option("--before"),
      after = option("--after");
    if (!before || !after)
      throw new Error(
        "compare requires --before and --after observation files",
      );
    result = compareObservationSets(
      await readObservationSet(before),
      await readObservationSet(after),
    );
  } else
    throw new Error(
      "Usage: figure:compare compare --before <file> --after <file> --out <file>",
    );
  await mkdir(dirname(resolve(out)), { recursive: true });
  await writeFile(out, JSON.stringify(result, null, 2) + "\n");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main(process.argv.slice(2));
}
