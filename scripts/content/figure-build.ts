import { conformations } from "../figure-template-data.ts";
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
import { parseFigureStyle } from "../../src/ui/library/scene-geometry.ts";
import { figureFontFiles, nativeFigureFontFile } from "../figure-fonts.ts";
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
  _root: string,
  css: string,
): ProofRunner {
  const pool = figureWorkerPool(css);
  return {
    async prepare(reference, slot) {
      const subset: Library = {};
      const add = (id: string) => {
        if (subset[id]) return;
        subset[id] = library[id];
        libraryDependencies(library[id]).forEach(add);
      };
      add(reference.ref);
      const result = await pool.prepare(
        { kind: "prepare", library: subset, reference },
        slot,
      );
      return { kind: "chemical", ...result };
    },
    diagnose: (geometry, slot) => pool.diagnose(geometry, slot),
    close: () => pool.close(),
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
  fonts.update(await readFile(await nativeFigureFontFile()));
  const [preparation, diagnostics, dependencies, diagnosticDependencies] =
    await Promise.all([
      figureRendererFingerprint(root, [
        "scripts/figure-preparation.ts",
        "src/ui/library/geometry-tree.ts",
        "scripts/chemical-toolkit.py",
        "scripts/chemical-toolkit-io.ts",
        "scripts/requirements-material.txt",
      ]),
      figureRendererFingerprint(root, ["scripts/figure-diagnostics.ts"]),
      figureDependencyFingerprint(root, [
        "fontkit",
        "svg-parser",
        "svgpath",
        "svg-path-properties",
      ]),
      figureDependencyFingerprint(root, ["svgpath", "svg-path-properties"]),
    ]);
  return {
    templates: Object.fromEntries(
      [...conformations].map(([id, data]) => [
        id,
        sha256(stableFigureValue(data)),
      ]),
    ),
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
  };
}
export async function verifyLibraryFigures(
  library: Library,
  references: FigureReference[],
  root: string,
  cacheDirectory?: string,
  stage?: AssetStage,
) {
  if (!Object.keys(library).length) return { assets: [], renders: {} };
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
      createRunner: async () => figureBuildRunner(library, root, css),
      onStats: (stats) =>
        console.log(
          `Figure proofs: ${stats.inputHits} inputs cached, ${stats.proofHits} proofs cached, ${stats.prepared} prepared, ${stats.diagnosed} diagnosed, ${stats.total} total`,
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
  const runner = figureBuildRunner(library, root, css);
  const renders: Record<string, LibraryFigureRender> = {};
  const assets = new Map<string, UnitAsset & { bytes: Buffer }>();
  try {
    for (const reference of references) {
      const key = figureViewKey(reference);
      if (renders[key]) continue;
      const prepared = await runner.prepare(reference, 0);
      if (prepared.kind !== "chemical") continue;
      const bytes = Buffer.from(prepared.svg),
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
        width: prepared.width ?? prepared.geometry!.width,
        height: prepared.height ?? prepared.geometry!.height,
        minimumScale: prepared.minimumScale ?? prepared.geometry!.minimumScale,
        diagnostics:
          prepared.diagnostics ??
          (await runner.diagnose(prepared.geometry!, 0)),
      };
    }
    return { renders, assets: [...assets.values()] };
  } finally {
    await runner.close();
  }
}
