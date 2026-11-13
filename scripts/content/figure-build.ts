import { templateDataFiles } from "../figure-template-data.ts";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import type {
  Library,
  FigureReference,
  LibraryFigureRender,
} from "../../shared/chemical-library/types.ts";
import { figureViewKey } from "../../shared/chemical-library/views.ts";
import type { UnitAsset } from "./content-files.ts";
import { libraryDependencies } from "../../shared/chemical-library/contract.ts";
import { sha256 } from "../../shared/assets.ts";
import { nativeDepictionGeometry } from "../../src/ui/library/native-geometry.ts";
import { walkGeometry } from "../../src/ui/library/geometry-walk.ts";
import { transformPoint } from "../../src/ui/library/geometry-math.ts";
import { geometrySvg } from "../../src/ui/library/geometry-tree.ts";
import { parseFigureStyle } from "../../src/ui/library/scene-geometry.ts";
import { figureFontFiles } from "../figure-fonts.ts";
import { figureBrowser } from "../figure-browser.ts";
import { figureWorkerPool } from "./figure-worker-pool.ts";
import { verifyFigureProofs, type ProofRunner } from "./figure-proofs.ts";
import { stableFigureValue } from "./figure-proof-cache.ts";
import {
  figureRendererFingerprint,
  figureDependencyFingerprint,
} from "./figure-renderer-fingerprint.ts";
import type { AssetStage } from "./asset-stage.ts";

export function figureBuildRunner(
  library: Library,
  root: string,
  css: string,
  processRenderer: string,
  stage?: AssetStage,
): ProofRunner {
  const pool = figureWorkerPool(css);
  let browser: Promise<Awaited<ReturnType<typeof figureBrowser>>> | undefined;
  return {
    async prepareBatch() {
      if (browser) await (await browser).prepareBatch();
    },
    async prepare(reference, slot) {
      const entry = library[reference.ref];
      const frame =
        entry.kind === "mechanism"
          ? (entry.frames.find((f) => f.id === reference.frame) ??
            entry.frames[0])
          : undefined;
      const drawings = frame?.drawings ?? entry.drawings;
      if (drawings) {
        const drawing = drawings[figureViewKey(reference)];
        if (!drawing)
          throw new Error(
            `${entry.id}/${frame?.id ?? "compound"}: no saved drawing for this reference`,
          );
        const file = stage
          ? (await stage.get(drawing.asset.slice(0, 64)))?.file
          : join(root, "library/assets", drawing.asset);
        if (!file) throw new Error(`${entry.id}: missing saved drawing asset`);
        const rootNode = nativeDepictionGeometry(await readFile(file, "utf8")),
          atomPoints: Record<
            string,
            import("../../shared/chemical-library/types.ts").Point
          > = {};
        walkGeometry(rootNode, (node, matrix) => {
          if (node.attributes["data-atom-points"])
            for (const [id, p] of Object.entries(
              JSON.parse(node.attributes["data-atom-points"]) as Record<
                string,
                import("../../shared/chemical-library/types.ts").Point
              >,
            ))
              atomPoints[id] = transformPoint(p, matrix);
        });
        const geometry = {
          format: 1 as const,
          width: drawing.width,
          height: drawing.height,
          minimumScale: drawing.minimumScale,
          atomPoints,
          root: rootNode,
        };
        return { kind: "chemical", geometry, svg: geometrySvg(geometry) };
      }
      if (entry.kind === "image")
        return {
          kind: "illustration",
          geometryKey: sha256(
            stableFigureValue({
              asset: entry.asset,
              width: entry.width,
              height: entry.height,
              crop: entry.crop,
            }),
          ),
        };
      if (entry.kind === "process")
        return {
          kind: "illustration",
          geometryKey: sha256(
            stableFigureValue({
              entry: { ...entry, sources: undefined },
              processRenderer,
            }),
          ),
        };
      const subset: Library = {};
      const add = (id: string) => {
        if (subset[id]) return;
        subset[id] = library[id];
        libraryDependencies(library[id]).forEach(add);
      };
      add(reference.ref);
      const geometry = await pool.prepare(
        { kind: "prepare", library: subset, reference },
        slot,
      );
      return { kind: "chemical", geometry, svg: geometrySvg(geometry) };
    },
    diagnose: (geometry, slot) => pool.diagnose(geometry, slot),
    async thumbnail(reference, render, slot) {
      const active = await (browser ??= figureBrowser(library, root, stage, 2));
      if (render) await active.mount(render, slot);
      else await active.render(reference, 1366, slot);
      return active.thumbnail(slot);
    },
    async close() {
      try {
        if (browser) await (await browser).close();
      } finally {
        await pool.close();
      }
    },
  };
}
export async function figureBuildVersions(css: string) {
  const root = join(import.meta.dirname, "../.."),
    style = parseFigureStyle(css);
  const fonts = createHash("sha256");
  for (const file of figureFontFiles())
    fonts
      .update(file)
      .update(await readFile(new URL(import.meta.resolve(file))));
  const [
    preparation,
    diagnostics,
    dependencies,
    diagnosticDependencies,
    processSources,
    processDependencies,
  ] = await Promise.all([
    figureRendererFingerprint(root, [
      "src/ui/library/prepare.ts",
      "scripts/content/figure-build.ts",
      "shared/molecule-toolkit.ts",
      "scripts/figure-fonts.ts",
      ...templateDataFiles(),
    ]),
    figureRendererFingerprint(root, ["scripts/figure-diagnostics.ts"]),
    figureDependencyFingerprint(root, [
      "@rdkit/rdkit",
      "fontkit",
      "svg-parser",
      "svgpath",
      "svg-path-properties",
    ]),
    figureDependencyFingerprint(root, ["svgpath", "svg-path-properties"]),
    figureRendererFingerprint(root, [
      "src/ui/topic/ProcessViewer.vue",
      "src/ui/styles/index.css",
    ]),
    figureDependencyFingerprint(root, ["vue"]),
  ]);
  return {
    renderer: sha256(
      stableFigureValue({
        preparation,
        dependencies,
        fonts: fonts.digest("hex"),
        style,
      }),
    ),
    diagnostics: sha256(
      stableFigureValue({
        diagnostics,
        dependencies: diagnosticDependencies,
        style,
      }),
    ),
    processRenderer: sha256(
      stableFigureValue({
        sources: processSources,
        dependencies: processDependencies,
      }),
    ),
  };
}
export async function verifyLibraryFigures(
  library: Library,
  references: FigureReference[],
  root: string,
  cacheDirectory?: string,
  stage?: AssetStage,
) {
  if (!Object.keys(library).length)
    return { assets: [], previews: {}, renders: {} };
  const css = await readFile(
    new URL("../../src/ui/styles/tokens.css", import.meta.url),
    "utf8",
  );
  const versions = await figureBuildVersions(css);
  const temporary = cacheDirectory
    ? undefined
    : await mkdtemp(join(tmpdir(), "figure-proofs-"));
  try {
    return await verifyFigureProofs(library, references, {
      directory: cacheDirectory ?? temporary!,
      stage,
      ...versions,
      createRunner: async () =>
        figureBuildRunner(library, root, css, versions.processRenderer, stage),
      onStats: (stats) =>
        console.log(
          `Figure proofs: ${stats.inputHits} inputs cached, ${stats.proofHits} proofs cached, ${stats.prepared} prepared, ${stats.diagnosed} diagnosed, ${stats.thumbnails} thumbnails, ${stats.total} total`,
        ),
    });
  } finally {
    if (temporary) await rm(temporary, { recursive: true, force: true });
  }
}

/** Prepare only the requested authoring views, without thumbnails or publication. */
export async function prepareFigureViews(
  library: Library,
  references: FigureReference[],
  root: string,
) {
  const css = await readFile(
    new URL("../../src/ui/styles/tokens.css", import.meta.url),
    "utf8",
  );
  const runner = figureBuildRunner(library, root, css, "preview");
  const renders: Record<string, LibraryFigureRender> = {};
  const assets = new Map<string, UnitAsset & { bytes: Buffer }>();
  try {
    for (const reference of references) {
      const key = figureViewKey(reference);
      if (renders[key]) continue;
      const prepared = await runner.prepare(reference, 0);
      if (prepared.kind !== "chemical") continue;
      const { geometry, svg } = prepared;
      const bytes = Buffer.from(svg),
        hash = sha256(bytes),
        path = `assets/${hash}.svg`;
      assets.set(path, {
        scope: "library",
        path,
        bytes,
        sha256: hash,
        size: bytes.length,
        content_type: "image/svg+xml",
        prompt: null,
      });
      renders[key] = {
        asset: `/library/${path}`,
        width: geometry.width,
        height: geometry.height,
        minimumScale: geometry.minimumScale,
        diagnostics: await runner.diagnose(geometry, 0),
      };
    }
    return { renders, assets: [...assets.values()] };
  } finally {
    await runner.close();
  }
}
