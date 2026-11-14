import { readFile, writeFile, mkdir, rename, rm, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { isObject } from "../../shared/json.ts";
import { sha256 } from "../../shared/assets.ts";
import {
  isFigureGeometry,
  isFigureDiagnostic,
} from "../../src/ui/library/geometry-contract.ts";
import type { FigureGeometry } from "../../shared/chemical-library/geometry.ts";
import type { Diagnostic } from "../../shared/chemical-library/types.ts";

export const stableFigureValue = (value: unknown): string =>
  JSON.stringify(value, (_key, item) =>
    isObject(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        )
      : item,
  );
export type PreparedFigure =
  | { kind: "chemical"; geometry: FigureGeometry; svg: string }
  | { kind: "illustration"; geometryKey: string };
export type PreparationMeta =
  | { kind: "illustration"; geometryKey: string }
  | {
      kind: "chemical";
      geometryKey: string;
      geometryHash: string;
      geometrySize: number;
      svgHash: string;
      svgSize: number;
      width: number;
      height: number;
      minimumScale: number;
    };
const finite = (v: unknown) => typeof v === "number" && Number.isFinite(v);
const hash = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
function meta(v: unknown): v is PreparationMeta {
  if (!isObject(v) || !hash(v.geometryKey)) return false;
  if (v.kind === "illustration") return true;
  return (
    v.kind === "chemical" &&
    hash(v.geometryHash) &&
    hash(v.svgHash) &&
    [v.geometrySize, v.svgSize, v.width, v.height, v.minimumScale].every(finite)
  );
}
async function atomic(path: string, bytes: Buffer | string) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = path + "." + randomUUID() + ".tmp";
  try {
    await writeFile(temporary, bytes);
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

export function figureProofCache(directory: string) {
  let writable = true;
  const file = (hash: string, extension: string) =>
    join(directory, "data", hash + extension);
  const write = async (path: string, value: Buffer | string) => {
    if (!writable) return;
    try {
      await atomic(path, value);
    } catch {
      writable = false;
      console.warn(
        "Figure proof cache could not be stored; this build retains its prepared results",
      );
    }
  };
  const store = async (path: string, key: string, value: unknown) =>
    write(
      path,
      JSON.stringify({
        format: 2,
        key,
        hash: sha256(stableFigureValue(value)),
        value,
      }),
    );
  const read = async (path: string, key: string): Promise<unknown> => {
    try {
      const record: unknown = JSON.parse(await readFile(path, "utf8"));
      if (
        !isObject(record) ||
        record.format !== 2 ||
        record.key !== key ||
        !hash(record.hash) ||
        record.hash !== sha256(stableFigureValue(record.value))
      )
        return;
      return record.value;
    } catch {
      return;
    }
  };
  return {
    async preparation(
      key: string,
    ): Promise<{ meta: PreparationMeta; svg?: Buffer } | undefined> {
      const value = await read(join(directory, "inputs", key + ".json"), key);
      if (!meta(value)) return;
      if (value.kind === "illustration") return { meta: value };
      try {
        const svg = await readFile(file(value.svgHash, ".svg"));
        if (
          svg.length !== value.svgSize ||
          sha256(svg) !== value.svgHash ||
          (await stat(file(value.geometryHash, ".geometry.json"))).size !==
            value.geometrySize
        )
          return;
        return { meta: value, svg };
      } catch {
        return;
      }
    },
    async savePreparation(
      key: string,
      prepared: PreparedFigure,
    ): Promise<{
      meta: PreparationMeta;
      svg?: Buffer;
      geometry?: FigureGeometry;
    }> {
      if (prepared.kind === "illustration") {
        const meta: PreparationMeta = prepared;
        await store(join(directory, "inputs", key + ".json"), key, meta);
        return { meta };
      }
      const bytes = Buffer.from(stableFigureValue(prepared.geometry)),
        svg = Buffer.from(prepared.svg);
      // Font lookup IDs locate outlines during preparation; only the outlines affect the proof.
      const geometryKey = sha256(
        JSON.stringify(JSON.parse(bytes.toString()), (key, value) =>
          key === "font" || key === "glyph" ? undefined : value,
        ),
      );
      const meta: PreparationMeta = {
        kind: "chemical",
        geometryKey,
        geometryHash: sha256(bytes),
        geometrySize: bytes.length,
        svgHash: sha256(svg),
        svgSize: svg.length,
        width: prepared.geometry.width,
        height: prepared.geometry.height,
        minimumScale: prepared.geometry.minimumScale,
      };
      await write(file(meta.geometryHash, ".geometry.json"), bytes);
      await write(file(meta.svgHash, ".svg"), svg);
      await store(join(directory, "inputs", key + ".json"), key, meta);
      return { meta, svg, geometry: prepared.geometry };
    },
    async geometry(
      meta: Extract<PreparationMeta, { kind: "chemical" }>,
    ): Promise<FigureGeometry | undefined> {
      try {
        const bytes = await readFile(file(meta.geometryHash, ".geometry.json"));
        if (
          bytes.length !== meta.geometrySize ||
          sha256(bytes) !== meta.geometryHash
        )
          return;
        const value: unknown = JSON.parse(bytes.toString());
        return isFigureGeometry(value) ? value : undefined;
      } catch {
        return;
      }
    },
    async proof(key: string): Promise<Diagnostic[] | undefined> {
      const value = await read(join(directory, "proofs", key + ".json"), key);
      if (
        !isObject(value) ||
        !Array.isArray(value.diagnostics) ||
        !value.diagnostics.every(isFigureDiagnostic)
      )
        return;
      return value.diagnostics;
    },
    saveProof: (key: string, diagnostics: Diagnostic[]) =>
      store(join(directory, "proofs", key + ".json"), key, { diagnostics }),
    async thumbnail(key: string) {
      const value = await read(
        join(directory, "thumbnails", key + ".json"),
        key,
      );
      if (!isObject(value) || !hash(value.hash)) return;
      try {
        const bytes = await readFile(file(value.hash, ".png"));
        return sha256(bytes) === value.hash ? bytes : undefined;
      } catch {
        return;
      }
    },
    async saveThumbnail(key: string, bytes: Buffer) {
      const hash = sha256(bytes);
      await write(file(hash, ".png"), bytes);
      await store(join(directory, "thumbnails", key + ".json"), key, { hash });
    },
  };
}
