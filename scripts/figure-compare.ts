import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isObject } from "../shared/json.ts";
import type {
  FigureObservation,
  FigureObservationSet,
  FigurePaint,
} from "../shared/chemical-library/geometry.ts";
import type { Diagnostic } from "../shared/chemical-library/types.ts";
import { validateFigureReference } from "../shared/chemical-library/contract.ts";
import {
  compareFigureGeometry,
  figureViewKey,
} from "../src/ui/library/geometry-compare.ts";
import { figureBrowser } from "./figure-browser.ts";
import { readChemicalLibrary } from "./content/chemical-library.ts";

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
const optionalNumber = (value: unknown) => value === undefined || finite(value);

function paint(value: unknown): value is FigurePaint {
  return (
    isObject(value) &&
    typeof value.fill === "string" &&
    typeof value.stroke === "string" &&
    [
      value.strokeWidth,
      value.opacity,
      value.fillOpacity,
      value.strokeOpacity,
      value.miterLimit,
    ].every(finite) &&
    (value.fillRule === "nonzero" || value.fillRule === "evenodd") &&
    (value.lineCap === "butt" ||
      value.lineCap === "round" ||
      value.lineCap === "square") &&
    (value.lineJoin === "miter" ||
      value.lineJoin === "round" ||
      value.lineJoin === "bevel") &&
    (value.dashArray === undefined || typeof value.dashArray === "string")
  );
}
function diagnostic(value: unknown): value is Diagnostic {
  return (
    isObject(value) &&
    typeof value.code === "string" &&
    (value.severity === "error" || value.severity === "warning") &&
    typeof value.object === "string" &&
    typeof value.message === "string" &&
    Array.isArray(value.elements) &&
    value.elements.every((item) => typeof item === "string") &&
    optionalNumber(value.actual) &&
    optionalNumber(value.required) &&
    (value.at === undefined || point(value.at)) &&
    (value.field === undefined || typeof value.field === "string")
  );
}
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
        paint(element.paint),
    ) &&
    Array.isArray(value.diagnostics) &&
    value.diagnostics.every(diagnostic)
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
  const views = keys.map((key) => ({
    key,
    ...(before.views[key] && after.views[key]
      ? {
          comparison: compareFigureGeometry(
            before.views[key],
            after.views[key],
          ),
        }
      : { unmatched: !before.views[key] ? "before" : "after" }),
    ...(before.failures[key] ? { beforeError: before.failures[key] } : {}),
    ...(after.failures[key] ? { afterError: after.failures[key] } : {}),
  }));
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
  let failed = false;
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
  } else if (command === "capture") {
    const root = option("--library"),
      refsFile = option("--references");
    if (!root || !refsFile)
      throw new Error("capture requires --library and --references");
    const values: unknown = JSON.parse(await readFile(refsFile, "utf8"));
    if (!Array.isArray(values)) throw new Error("References must be an array");
    const references = values.map((value: unknown) => {
      validateFigureReference(value);
      return value;
    });
    const library = (await readChemicalLibrary(resolve(root))).entries;
    const observations: FigureObservationSet = { views: {}, failures: {} };
    const runner = await figureBrowser(library, resolve(root));
    try {
      for (const reference of references) {
        const key = figureViewKey(reference);
        if (key in observations.views || key in observations.failures) continue;
        try {
          await runner.prepareBatch();
          const rendered = await runner.render(reference, 1366);
          observations.views[key] = await runner.observation(rendered);
        } catch (error) {
          observations.failures[key] =
            error instanceof Error ? error.message : String(error);
        }
      }
    } finally {
      await runner.close();
    }
    failed = Object.keys(observations.failures).length > 0;
    result = observations;
  } else
    throw new Error(
      "Usage: figure:compare capture|compare --out <file.json> [options]",
    );
  await mkdir(dirname(resolve(out)), { recursive: true });
  await writeFile(out, JSON.stringify(result, null, 2) + "\n");
  if (failed) process.exitCode = 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main(process.argv.slice(2));
}
