import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  Library,
  FigureReference,
} from "../shared/chemical-library/types.ts";
import { figureBrowser } from "./figure-browser.ts";
import { figureBuildRunner } from "./content/figure-build.ts";
import { figureProofReferences } from "./content/figure-proofs.ts";
import {
  figureViewKey,
  compareFigureGeometry,
} from "../src/ui/library/geometry-compare.ts";
import { geometryObservation } from "../src/ui/library/geometry-observation.ts";

export async function comparePreparedFigures(
  library: Library,
  references: FigureReference[],
  root: string,
  samples: FigureReference[] = [],
  screens?: string,
  includeDefaults = true,
) {
  const css = await readFile(
    new URL("../src/ui/styles/tokens.css", import.meta.url),
    "utf8",
  );
  const node = figureBuildRunner(library, root, css, "comparison"),
    browser = await figureBrowser(library, root, undefined, 2);
  references = references.map((reference) => {
    const entry = library[reference.ref];
    return entry?.kind === "mechanism"
      ? { ...reference, frame: reference.frame ?? entry.frames[0]?.id }
      : reference;
  });
  const all = includeDefaults
    ? figureProofReferences(library, references)
    : [
        ...new Map(
          references.map((reference) => [figureViewKey(reference), reference]),
        ).values(),
      ];
  const chemical = all.filter(
    (ref) => !["image", "process"].includes(library[ref.ref].kind),
  );
  const sizes: number[] = [],
    views: Array<{
      key: string;
      comparison?: ReturnType<typeof compareFigureGeometry>;
      beforeError?: string;
      afterError?: string;
    }> = [];
  samples = samples.map((reference) => {
    const entry = library[reference.ref];
    return entry?.kind === "mechanism"
      ? { ...reference, frame: reference.frame ?? entry.frames[0]?.id }
      : reference;
  });
  const sampleKeys = new Map(
    samples.map((ref, i) => [
      figureViewKey(ref),
      `sample-${String(i + 1).padStart(2, "0")}`,
    ]),
  );
  if (screens) {
    await mkdir(screens, { recursive: true });
    await mkdir(join(screens, "before"), { recursive: true });
  }
  const started = performance.now();
  try {
    for (let offset = 0; offset < chemical.length; offset += 2) {
      await browser.prepareBatch();
      views.push(
        ...(await Promise.all(
          chemical.slice(offset, offset + 2).map(async (reference, slot) => {
            const key = figureViewKey(reference),
              sample = sampleKeys.get(key);
            let before, after, prepared;
            let beforeError: string | undefined, afterError: string | undefined;
            try {
              const rendered = await browser.render(reference, 1366, slot);
              before = await browser.observation(rendered, slot);
              if (sample && screens) {
                await browser.pages[slot].screenshot({
                  path: join(screens, "before", sample + "-1366.png"),
                });
                await browser.render(reference, 390, slot);
                await browser.pages[slot].screenshot({
                  path: join(screens, "before", sample + "-390.png"),
                });
              }
            } catch (error) {
              beforeError =
                error instanceof Error ? error.message : String(error);
            }
            try {
              prepared = await node.prepare(reference, slot);
              if (prepared.kind !== "chemical")
                throw new Error("Expected chemical geometry");
              const diagnostics = await node.diagnose(prepared.geometry, slot);
              after = geometryObservation(prepared.geometry, diagnostics);
              sizes.push(Buffer.byteLength(prepared.svg));
              if (sample && screens) {
                for (const width of [1366, 390]) {
                  await browser.mount(
                    { svg: prepared.svg, ...prepared.geometry },
                    slot,
                    width,
                  );
                  await browser.pages[slot]
                    .locator("#title")
                    .evaluate(
                      (element, title) => (element.textContent = title),
                      library[reference.ref].title,
                    );
                  await browser.pages[slot].screenshot({
                    path: join(screens, sample + `-${width}.png`),
                  });
                }
              }
            } catch (error) {
              afterError =
                error instanceof Error ? error.message : String(error);
            }
            return {
              key,
              ...(before && after
                ? { comparison: compareFigureGeometry(before, after) }
                : {}),
              ...(beforeError ? { beforeError } : {}),
              ...(afterError ? { afterError } : {}),
            };
          }),
        )),
      );
      if (offset % 100 === 0 || offset + 2 >= chemical.length)
        console.log(
          `Compared ${Math.min(offset + 2, chemical.length)}/${chemical.length} chemical views`,
        );
    }
  } finally {
    try {
      await browser.close();
    } finally {
      await node.close();
    }
  }
  sizes.sort((a, b) => a - b);
  const percentile = (fraction: number) =>
    sizes.length ? sizes[Math.ceil((sizes.length - 1) * fraction)] : 0;
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
    total: all.length,
    chemical: chemical.length,
    illustrations: all.length - chemical.length,
    unchanged: views.length - changed.length,
    failures: views.filter((row) => row.beforeError || row.afterError),
    maximumBoundsDelta: Math.max(
      0,
      ...views.map((row) => row.comparison?.maximumBoundsDelta ?? 0),
    ),
    maximumTraceDelta: Math.max(
      0,
      ...views.map((row) => row.comparison?.maximumTraceDelta ?? 0),
    ),
    diagnosticSetChanges: views
      .filter(
        (row) =>
          row.comparison &&
          (row.comparison.diagnostics.added.length ||
            row.comparison.diagnostics.removed.length),
      )
      .map((row) => ({ key: row.key, ...row.comparison!.diagnostics })),
    svgBytes: {
      count: sizes.length,
      total: sizes.reduce((a, b) => a + b, 0),
      minimum: sizes[0] ?? 0,
      median: percentile(0.5),
      p95: percentile(0.95),
      maximum: sizes.at(-1) ?? 0,
    },
    elapsedSeconds: (performance.now() - started) / 1000,
    samples: samples.map((reference, i) => ({
      view: `sample-${String(i + 1).padStart(2, "0")}`,
      reference,
    })),
    changed,
  };
}
