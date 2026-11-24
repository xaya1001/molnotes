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

export const stableFigureValue = (
  value: unknown,
  omit?: ReadonlySet<string>,
): string => {
  const encode = (v: unknown): string | undefined => {
    if (v === null || typeof v !== "object") return JSON.stringify(v);
    if (Array.isArray(v)) {
      let out = "[";
      for (let i = 0; i < v.length; i++) {
        if (i) out += ",";
        const item = encode(v[i]);
        out += item === undefined ? "null" : item;
      }
      return out + "]";
    }
    const keys = Object.keys(v as Record<string, unknown>).sort();
    let out = "{";
    let first = true;
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (omit?.has(k)) continue;
      const encoded = encode((v as Record<string, unknown>)[k]);
      if (encoded === undefined) continue;
      if (!first) out += ",";
      first = false;
      out += JSON.stringify(k) + ":" + encoded;
    }
    return out + "}";
  };
  return encode(value) ?? "undefined";
};
export const geometryKeyOmit = new Set(["font", "glyph"]);
export interface PreparedFigure {
  kind: "chemical";
  geometry?: FigureGeometry;
  geometryBytes?: Uint8Array;
  geometryKey?: string;
  width?: number;
  height?: number;
  minimumScale?: number;
  svg: string;
  diagnostics?: Diagnostic[];
}
export interface PreparationMeta {
  kind: "chemical";
  geometryKey: string;
  geometryHash: string;
  geometrySize: number;
  svgHash: string;
  svgSize: number;
  width: number;
  height: number;
  minimumScale: number;
}
const finite = (v: unknown) => typeof v === "number" && Number.isFinite(v);
const hash = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
function meta(v: unknown): v is PreparationMeta {
  if (!isObject(v) || !hash(v.geometryKey)) return false;
  return (
    v.kind === "chemical" &&
    hash(v.geometryHash) &&
    hash(v.svgHash) &&
    [v.geometrySize, v.svgSize, v.width, v.height, v.minimumScale].every(finite)
  );
}

export function figureProofCache(directory: string) {
  let writable = true;
  const file = (hash: string, extension: string) =>
    join(directory, "data", hash + extension);
  const dirs = new Set<string>();
  const ensureDir = async (dir: string) => {
    if (dirs.has(dir)) return;
    await mkdir(dir, { recursive: true });
    dirs.add(dir);
  };
  const write = async (path: string, value: Buffer | string) => {
    if (!writable) return;
    try {
      await ensureDir(dirname(path));
      const temporary = path + "." + randomUUID() + ".tmp";
      try {
        await writeFile(temporary, value);
        await rename(temporary, path);
      } finally {
        await rm(temporary, { force: true });
      }
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
    ): Promise<{ meta: PreparationMeta; svg: Buffer } | undefined> {
      const value = await read(join(directory, "inputs", key + ".json"), key);
      if (!meta(value)) return;
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
      svg: Buffer;
      geometry?: FigureGeometry;
      diagnostics?: Diagnostic[];
    }> {
      const bytes = prepared.geometryBytes
          ? Buffer.from(
              prepared.geometryBytes.buffer,
              prepared.geometryBytes.byteOffset,
              prepared.geometryBytes.byteLength,
            )
          : Buffer.from(stableFigureValue(prepared.geometry!)),
        svg = Buffer.from(prepared.svg);
      // Font lookup IDs locate outlines during preparation; only the outlines affect the proof.
      const geometryKey =
        prepared.geometryKey ??
        sha256(stableFigureValue(prepared.geometry!, geometryKeyOmit));
      const meta: PreparationMeta = {
        kind: "chemical",
        geometryKey,
        geometryHash: sha256(bytes),
        geometrySize: bytes.length,
        svgHash: sha256(svg),
        svgSize: svg.length,
        width: prepared.width ?? prepared.geometry!.width,
        height: prepared.height ?? prepared.geometry!.height,
        minimumScale: prepared.minimumScale ?? prepared.geometry!.minimumScale,
      };
      await Promise.all([
        write(file(meta.geometryHash, ".geometry.json"), bytes),
        write(file(meta.svgHash, ".svg"), svg),
        store(join(directory, "inputs", key + ".json"), key, meta),
      ]);
      return {
        meta,
        svg,
        geometry: prepared.geometry,
        diagnostics: prepared.diagnostics,
      };
    },
    async geometry(meta: PreparationMeta): Promise<FigureGeometry | undefined> {
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
  };
}
