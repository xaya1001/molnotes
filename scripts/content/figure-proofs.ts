import type {
  Library,
  FigureReference,
  Diagnostic,
  LibraryFigureRender,
} from "../../shared/chemical-library/types.ts";
import type { FigureGeometry } from "../../shared/chemical-library/geometry.ts";
import type { UnitAsset } from "./content-files.ts";
import { sha256 } from "../../shared/assets.ts";
import {
  figureViewKeys,
  libraryDependencies,
} from "../../shared/chemical-library/contract.ts";
import { figureViewKey } from "../../shared/chemical-library/views.ts";
import {
  figureProofCache,
  stableFigureValue,
  type PreparedFigure,
} from "./figure-proof-cache.ts";
import type { AssetStage } from "./asset-stage.ts";
import { logTiming } from "../../shared/stage-timing.ts";

export interface ProofRunner {
  prepare(reference: FigureReference, slot: number): Promise<PreparedFigure>;
  diagnose(geometry: FigureGeometry, slot: number): Promise<Diagnostic[]>;
  close(): Promise<void>;
}
export interface ProofStats {
  inputHits: number;
  proofHits: number;
  prepared: number;
  diagnosed: number;
  total: number;
}
export interface ProofOptions {
  directory: string;
  renderer: string;
  diagnostics: string;
  templates: Record<string, string>;
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
            template:
              library[id].kind === "conformation"
                ? options.templates[library[id].template]
                : undefined,
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
    total: 0,
  };
  // Worker times are accumulated across the two slots, rather than wall time.
  const durations = { prepare: 0, proof: 0 };
  async function timed<T>(
    kind: keyof typeof durations,
    operation: () => Promise<T>,
  ) {
    const start = performance.now();
    try {
      return await operation();
    } finally {
      durations[kind] += performance.now() - start;
    }
  }
  const unique = figureProofReferences(library, references),
    failures: string[] = [];
  const jobs = unique.map((reference) => ({
    reference,
    key: sha256(
      stableFigureValue({
        format: 2,
        renderer: options.renderer,
        entry: digest(reference.ref),
        reference,
      }),
    ),
  }));
  stats.total = jobs.length;
  let runner: Promise<ProofRunner> | undefined;
  const active = () => (runner ??= options.createRunner());
  const savedAssets = new Set<string>();
  const asset = async (bytes: Buffer) => {
    const hash = sha256(bytes),
      path = `assets/${hash}.svg`;
    if (savedAssets.has(path)) return `/library/${path}`;
    savedAssets.add(path);
    assets.push({
      scope: "library",
      path,
      bytes: options.stage ? await options.stage.save(bytes, hash) : bytes,
      sha256: hash,
      size: bytes.length,
      content_type: "image/svg+xml",
      prompt: null,
    });
    return `/library/${path}`;
  };
  try {
    const render = async (job: (typeof jobs)[number], slot: number) => {
      try {
        let prepared = await cache.preparation(job.key),
          geometry: FigureGeometry | undefined,
          preparedDiagnostics: Diagnostic[] | undefined;
        const prepare = async () => {
          stats.prepared++;
          const result = await cache.savePreparation(
            job.key,
            await timed("prepare", async () =>
              (await active()).prepare(job.reference, slot),
            ),
          );
          geometry = result.geometry;
          preparedDiagnostics = result.diagnostics;
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
        else if (preparedDiagnostics) {
          stats.diagnosed++;
          diagnostics = preparedDiagnostics;
          await cache.saveProof(proofKey, diagnostics);
        } else {
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
          if (preparedDiagnostics) {
            stats.diagnosed++;
            diagnostics = preparedDiagnostics;
          } else {
            if (!geometry)
              throw new Error("Chemical preparation did not produce geometry");
            stats.diagnosed++;
            diagnostics = await timed("proof", async () =>
              (await active()).diagnose(geometry!, slot),
            );
          }
          await cache.saveProof(proofKey, diagnostics);
        }
        return { ...job, prepared, diagnostics };
      } catch (error) {
        return {
          ...job,
          error: `${job.reference.ref}: ${error instanceof Error ? error.message : String(error)} (${stableFigureValue(job.reference)})`,
        };
      }
    };
    const results: Awaited<ReturnType<typeof render>>[] = new Array(
      jobs.length,
    );
    let next = 0;
    await Promise.all(
      [0, 1].map(async (slot) => {
        while (next < jobs.length) {
          const index = next++;
          results[index] = await render(jobs[index], slot);
        }
      }),
    );
    // Preserve reference order regardless of worker completion order.
    for (const result of results) {
      if ("error" in result) {
        failures.push(result.error);
        continue;
      }
      const { meta, svg } = result.prepared;
      renders[figureViewKey(result.reference)] = {
        asset: await asset(svg),
        width: meta.width,
        height: meta.height,
        minimumScale: meta.minimumScale,
        diagnostics: result.diagnostics,
      };
    }
  } finally {
    for (const [stage, durationMs] of Object.entries(durations))
      logTiming({
        stage: `figure.${stage}`,
        result: failures.length ? "failed" : "success",
        durationMs: Math.round(durationMs * 100) / 100,
      });
    options.onStats?.(stats);
    if (runner)
      await runner.then(
        (r) => r.close(),
        () => {},
      );
  }
  if (failures.length)
    throw new Error(`Figure proofs failed:\n${failures.join("\n")}`);
  return { assets, renders, stats };
}

export function figureLibrarySubset(library: Library, ids: string[]): Library {
  const subset: Library = {};
  function add(id: string) {
    if (subset[id]) return;
    subset[id] = library[id];
    libraryDependencies(library[id]).forEach(add);
  }
  ids.forEach(add);
  return subset;
}

export function figureProofReferences(
  library: Library,
  references: FigureReference[],
): FigureReference[] {
  const refs: FigureReference[] = [
    ...Object.values(library).flatMap((entry) =>
      entry.kind === "image"
        ? []
        : [
            { ref: entry.id },
            ...figureViewKeys(entry).map((id) => ({
              ref: entry.id,
              frame: id,
            })),
            ...(entry.kind === "compound"
              ? Object.keys(entry.variants ?? {}).map((variant) => ({
                  ref: entry.id,
                  variant,
                }))
              : []),
          ],
    ),
    ...references.filter(
      (reference) => library[reference.ref]?.kind !== "image",
    ),
  ];
  return [
    ...new Map(
      refs.map((reference) => {
        const entry = library[reference.ref];
        const kind = entry?.kind;
        const instance: FigureReference = { ref: reference.ref };
        if (kind === "compound") instance.variant = reference.variant;
        if (reference.frame) instance.frame = reference.frame;
        instance.numbers = reference.numbers;
        instance.focus = reference.focus;
        return [stableFigureValue(instance), instance];
      }),
    ).values(),
  ];
}
