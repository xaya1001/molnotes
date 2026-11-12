import type {
  Library,
  FigureReference,
  Diagnostic,
  LibraryFigureRender,
} from "../../shared/chemical-library/types.ts";
import type { FigureGeometry } from "../../shared/chemical-library/geometry.ts";
import type { UnitAsset } from "./content-files.ts";
import { sha256 } from "../../shared/assets.ts";
import { libraryDependencies } from "../../shared/chemical-library/contract.ts";
import { figureViewKey } from "../../src/ui/library/geometry-compare.ts";
import {
  figureProofCache,
  stableFigureValue,
  type PreparedFigure,
} from "./figure-proof-cache.ts";
import type { AssetStage } from "./asset-stage.ts";

export interface ProofRunner {
  prepareBatch?(): Promise<void>;
  prepare(reference: FigureReference, slot: number): Promise<PreparedFigure>;
  diagnose(geometry: FigureGeometry, slot: number): Promise<Diagnostic[]>;
  thumbnail(
    reference: FigureReference,
    render:
      | { svg: string; width: number; height: number; minimumScale: number }
      | undefined,
    slot: number,
  ): Promise<Buffer>;
  close(): Promise<void>;
}
export interface ProofStats {
  inputHits: number;
  proofHits: number;
  prepared: number;
  diagnosed: number;
  thumbnails: number;
  total: number;
}
export interface ProofOptions {
  directory: string;
  renderer: string;
  diagnostics: string;
  processRenderer: string;
  stage?: AssetStage;
  createRunner(): Promise<ProofRunner>;
  onStats?(stats: ProofStats): void;
}
export async function verifyFigureProofs(
  library: Library,
  references: FigureReference[],
  options: ProofOptions,
) {
  const assets: UnitAsset[] = [],
    previews: Record<string, string> = {},
    renders: Record<string, LibraryFigureRender> = {};
  const cache = figureProofCache(options.directory),
    digests = new Map<string, string>();
  const digest = (id: string): string => {
    if (!digests.has(id))
      digests.set(
        id,
        sha256(
          stableFigureValue({
            entry: library[id],
            dependencies: [...new Set(libraryDependencies(library[id]))]
              .sort()
              .map((dependency) => [dependency, digest(dependency)]),
          }),
        ),
      );
    return digests.get(id)!;
  };
  const stats: ProofStats = {
    inputHits: 0,
    proofHits: 0,
    prepared: 0,
    diagnosed: 0,
    thumbnails: 0,
    total: 0,
  };
  const unique = figureProofReferences(library, references),
    thumbnailRefs = new Set<string>(),
    failures: string[] = [];
  const jobs = unique.map((reference) => {
    const thumbnail = !thumbnailRefs.has(reference.ref);
    thumbnailRefs.add(reference.ref);
    const kind = library[reference.ref]?.kind;
    return {
      reference,
      thumbnail,
      key: sha256(
        stableFigureValue({
          format: 2,
          renderer:
            kind === "image"
              ? "image"
              : kind === "process"
                ? options.processRenderer
                : options.renderer,
          entry: digest(reference.ref),
          reference,
        }),
      ),
    };
  });
  stats.total = jobs.length;
  let runner: Promise<ProofRunner> | undefined;
  const active = () => (runner ??= options.createRunner());
  const savedAssets = new Set<string>();
  const asset = async (bytes: Buffer, extension: "png" | "svg") => {
    const hash = sha256(bytes),
      path = `assets/${hash}.${extension}`;
    if (savedAssets.has(path)) return `/library/${path}`;
    savedAssets.add(path);
    assets.push({
      scope: "library",
      path,
      bytes: options.stage ? await options.stage.save(bytes, hash) : bytes,
      sha256: hash,
      size: bytes.length,
      content_type: extension === "svg" ? "image/svg+xml" : "image/png",
      prompt: null,
    });
    return `/library/${path}`;
  };
  try {
    for (let offset = 0; offset < jobs.length; offset += 2) {
      if (runner) await (await runner).prepareBatch?.();
      const results = await Promise.all(
        jobs.slice(offset, offset + 2).map(async (job, slot) => {
          try {
            let prepared = await cache.preparation(job.key),
              geometry: FigureGeometry | undefined;
            const prepare = async () => {
              stats.prepared++;
              const result = await cache.savePreparation(
                job.key,
                await (await active()).prepare(job.reference, slot),
              );
              geometry = result.geometry;
              return result;
            };
            if (prepared) stats.inputHits++;
            else prepared = await prepare();
            let proofKey = sha256(
              stableFigureValue({
                geometry: prepared.meta.geometryKey,
                diagnostics: options.diagnostics,
                viewport: { width: 1366, height: 900 },
              }),
            );
            let diagnostics = await cache.proof(proofKey);
            if (diagnostics) stats.proofHits++;
            else {
              if (prepared.meta.kind === "chemical") {
                geometry ??= await cache.geometry(prepared.meta);
                if (!geometry) {
                  prepared = await prepare();
                  proofKey = sha256(
                    stableFigureValue({
                      geometry: prepared.meta.geometryKey,
                      diagnostics: options.diagnostics,
                      viewport: { width: 1366, height: 900 },
                    }),
                  );
                }
                if (!geometry)
                  throw new Error(
                    "Chemical preparation did not produce geometry",
                  );
                stats.diagnosed++;
                diagnostics = await (await active()).diagnose(geometry, slot);
              } else diagnostics = [];
              const errors = diagnostics.filter((d) => d.severity === "error");
              if (errors.length)
                throw new Error(
                  errors
                    .map((d) => `${d.code} ${d.elements.join(",")}`)
                    .join("; "),
                );
              await cache.saveProof(proofKey, diagnostics);
            }
            let bytes: Buffer | undefined;
            if (job.thumbnail) {
              bytes = await cache.thumbnail(prepared.meta.geometryKey);
              if (!bytes) {
                const { meta, svg } = prepared;
                stats.thumbnails++;
                bytes = await (
                  await active()
                ).thumbnail(
                  job.reference,
                  meta.kind === "chemical"
                    ? {
                        svg: svg!.toString(),
                        width: meta.width,
                        height: meta.height,
                        minimumScale: meta.minimumScale,
                      }
                    : undefined,
                  slot,
                );
                await cache.saveThumbnail(meta.geometryKey, bytes);
              }
            }
            return { ...job, prepared, diagnostics, bytes };
          } catch (error) {
            return {
              ...job,
              error: `${job.reference.ref}: ${error instanceof Error ? error.message : String(error)} (${stableFigureValue(job.reference)})`,
            };
          }
        }),
      );
      // Preserve reference order regardless of worker completion order.
      for (const result of results) {
        if ("error" in result) {
          failures.push(result.error);
          continue;
        }
        if (result.thumbnail)
          previews[result.reference.ref] = await asset(result.bytes!, "png");
        const { meta, svg } = result.prepared;
        if (meta.kind === "chemical")
          renders[figureViewKey(result.reference)] = {
            asset: await asset(svg!, "svg"),
            width: meta.width,
            height: meta.height,
            minimumScale: meta.minimumScale,
            diagnostics: result.diagnostics,
          };
      }
    }
  } finally {
    options.onStats?.(stats);
    if (runner)
      await runner.then(
        (r) => r.close(),
        () => {},
      );
  }
  if (failures.length)
    throw new Error(`Figure proofs failed:\n${failures.join("\n")}`);
  return { assets, previews, renders, stats };
}

export function figureProofReferences(
  library: Library,
  references: FigureReference[],
): FigureReference[] {
  const refs: FigureReference[] = [
    ...Object.values(library).flatMap((entry) =>
      entry.kind === "mechanism"
        ? entry.frames.map((frame) => ({ ref: entry.id, frame: frame.id }))
        : entry.kind === "compound"
          ? [
              { ref: entry.id },
              ...Object.keys(entry.variants ?? {}).map((variant) => ({
                ref: entry.id,
                variant,
              })),
            ]
          : [{ ref: entry.id }],
    ),
    ...references,
  ];
  return [
    ...new Map(
      refs.map((reference) => {
        const entry = library[reference.ref];
        const kind = entry?.kind;
        const instance: FigureReference = { ref: reference.ref };
        if (kind !== "image" && kind !== "process") {
          if (kind === "compound") instance.variant = reference.variant;
          if (entry?.kind === "mechanism")
            instance.frame = reference.frame ?? entry.frames[0]?.id;
          instance.numbers = reference.numbers;
          instance.focus = reference.focus;
        }
        return [stableFigureValue(instance), instance];
      }),
    ).values(),
  ];
}
