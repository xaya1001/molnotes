import type {
  Library,
  FigureReference,
  Diagnostic,
} from "../../shared/chemical-library/types.ts";
import type { UnitAsset } from "./content-files.ts";
import { sha256 } from "../../shared/assets.ts";
import { libraryDependencies } from "../../shared/chemical-library/contract.ts";
import { isObject } from "../../shared/json.ts";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AssetStage } from "./asset-stage.ts";

const stable = (value: unknown) =>
  JSON.stringify(value, (_key, item) =>
    isObject(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
        )
      : item,
  );

async function atomic(file: string, bytes: string | Buffer) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, bytes);
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function cached(
  directory: string,
  key: string,
  thumbnail: boolean,
): Promise<{ bytes?: Buffer } | undefined> {
  try {
    const record: unknown = JSON.parse(
      await readFile(join(directory, key + ".json"), "utf8"),
    );
    if (
      !isObject(record) ||
      record.format !== 1 ||
      record.key !== key ||
      record.passed !== true
    )
      return;
    if (!thumbnail) return {};
    if (
      typeof record.thumbnail !== "string" ||
      !/^[a-f0-9]{64}$/.test(record.thumbnail)
    )
      return;
    const bytes = await readFile(join(directory, key + ".png"));
    if (sha256(bytes) !== record.thumbnail) return;
    return { bytes };
  } catch {
    return;
  }
}

export interface ProofRunner {
  prepareBatch?(): Promise<void>;
  render(
    reference: FigureReference,
    width: number,
    slot?: number,
  ): Promise<{ diagnostics: Diagnostic[] }>;
  thumbnail(slot?: number): Promise<Buffer>;
  close(): Promise<void>;
}
export interface ProofOptions {
  directory: string;
  renderer: string;
  stage?: AssetStage;
  createRunner(): Promise<ProofRunner>;
  onStats?(stats: { hits: number; rendered: number; total: number }): void;
}
export async function verifyFigureProofs(
  library: Library,
  references: FigureReference[],
  options: ProofOptions,
) {
  const assets: UnitAsset[] = [],
    previews: Record<string, string> = {};
  const digests = new Map<string, string>();
  const digest = (id: string): string => {
    if (!digests.has(id))
      digests.set(
        id,
        sha256(
          stable({
            entry: library[id],
            dependencies: [...new Set(libraryDependencies(library[id]))]
              .sort()
              .map((dependency) => [dependency, digest(dependency)]),
          }),
        ),
      );
    return digests.get(id)!;
  };
  const stats = { hits: 0, rendered: 0, total: 0 };
  const unique = figureProofReferences(library, references);
  let runner: Promise<ProofRunner> | undefined;
  let store = true;
  const failures: string[] = [];
  const thumbnailRefs = new Set<string>();
  const jobs = unique.map((reference) => {
    const thumbnail = !thumbnailRefs.has(reference.ref);
    thumbnailRefs.add(reference.ref);
    return {
      reference,
      thumbnail,
      key: sha256(
        stable({
          format: 1,
          renderer: options.renderer,
          entry: digest(reference.ref),
          reference,
          viewport: { width: 1366, height: 900 },
        }),
      ),
    };
  });
  stats.total = jobs.length;
  try {
    for (let offset = 0; offset < jobs.length; offset += 2) {
      let batchRunner: Promise<ProofRunner> | undefined;
      const results = await Promise.all(
        jobs.slice(offset, offset + 2).map(async (job, slot) => {
          try {
            const prior = await cached(
              options.directory,
              job.key,
              job.thumbnail,
            );
            if (prior) {
              stats.hits++;
              return { ...job, bytes: prior.bytes, cached: true };
            }
            batchRunner ??= (async () => {
              runner ??= options.createRunner();
              const active = await runner;
              await active.prepareBatch?.();
              return active;
            })();
            const active = await batchRunner;
            stats.rendered++;
            const result = await active.render(job.reference, 1366, slot);
            const errors = result.diagnostics.filter(
              (d) => d.severity === "error",
            );
            if (errors.length)
              throw new Error(
                errors
                  .map((d) => `${d.code} ${d.elements.join(",")}`)
                  .join("; "),
              );
            const bytes = job.thumbnail
              ? await active.thumbnail(slot)
              : undefined;
            return { ...job, bytes, cached: false };
          } catch (error) {
            return {
              ...job,
              error: `${job.reference.ref}: ${error instanceof Error ? error.message : String(error)} (${stable(job.reference)})`,
            };
          }
        }),
      );
      // Commit results in reference order, independently of page completion order.
      for (const result of results) {
        if ("error" in result) {
          failures.push(result.error);
          continue;
        }
        const { key, bytes, thumbnail, reference } = result;
        if (!result.cached && store)
          try {
            await mkdir(options.directory, { recursive: true });
            if (bytes)
              await atomic(join(options.directory, key + ".png"), bytes);
            await atomic(
              join(options.directory, key + ".json"),
              JSON.stringify({
                format: 1,
                key,
                passed: true,
                ...(bytes ? { thumbnail: sha256(bytes) } : {}),
              }),
            );
          } catch {
            store = false;
            console.warn(
              "Figure proof cache could not be stored; the rendered proof remains valid",
            );
          }
        if (thumbnail) {
          const png = bytes!,
            hash = sha256(png),
            path = `assets/${hash}.png`;
          assets.push({
            scope: "library",
            path,
            bytes: options.stage ? await options.stage.save(png, hash) : png,
            sha256: hash,
            size: png.length,
            content_type: "image/png",
            prompt: null,
          });
          previews[reference.ref] = `/library/${path}`;
        }
      }
    }
  } finally {
    options.onStats?.(stats);
    if (runner)
      await runner.then(
        (active) => active.close(),
        () => {},
      );
  }
  if (failures.length)
    throw new Error(`Figure proofs failed:\n${failures.join("\n")}`);
  return { assets, previews, stats };
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
        return [stable(instance), instance];
      }),
    ).values(),
  ];
}
