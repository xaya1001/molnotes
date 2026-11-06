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
  render(
    reference: FigureReference,
    width: number,
  ): Promise<{ diagnostics: Diagnostic[] }>;
  thumbnail(): Promise<Buffer>;
  close(): Promise<void>;
}
export interface ProofOptions {
  directory: string;
  renderer: string;
  stage?: AssetStage;
  createRunner(): Promise<ProofRunner>;
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
  const refs = [
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
  const unique = [
    ...new Map(
      refs.map((reference) => {
        const kind = library[reference.ref]?.kind;
        const instance =
          kind === "image" || kind === "process"
            ? { ref: reference.ref }
            : reference;
        return [JSON.stringify(instance), instance];
      }),
    ).values(),
  ];
  let runner: ProofRunner | undefined;
  let store = true;
  try {
    for (const reference of unique)
      for (const width of [1366, 390]) {
        stats.total++;
        const thumbnail = width === 1366 && !previews[reference.ref];
        const key = sha256(
          stable({
            format: 1,
            renderer: options.renderer,
            entry: digest(reference.ref),
            reference,
            viewport: { width, height: width === 1366 ? 900 : 844 },
          }),
        );
        const prior = await cached(options.directory, key, thumbnail);
        let bytes = prior?.bytes;
        if (prior) stats.hits++;
        else {
          runner ??= await options.createRunner();
          const result = await runner.render(reference, width);
          stats.rendered++;
          const errors = result.diagnostics.filter(
            (d) => d.severity === "error",
          );
          if (errors.length)
            throw new Error(
              `${reference.ref}: ${errors.map((d) => `${d.code} ${d.elements.join(",")}`).join("; ")}`,
            );
          if (thumbnail) bytes = await runner.thumbnail();
          if (store)
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
        }
        if (thumbnail) {
          const hash = sha256(bytes!),
            path = `assets/${hash}.png`;
          const png = bytes!;
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
  } finally {
    await runner?.close();
  }
  return { assets, previews, stats };
}
