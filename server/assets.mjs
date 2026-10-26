import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename, stat, rm } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { resolve, join, extname } from "node:path";
import { storage } from "../scripts/r2.mjs";

export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
const types = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".pdb": "chemical/x-pdb",
  ".json": "application/json",
  ".mp4": "video/mp4",
  ".pdf": "application/pdf",
  ".css": "text/css",
  ".js": "text/javascript",
  ".html": "text/html",
  ".woff2": "font/woff2",
};
export const contentType = (path) =>
  types[extname(path).toLowerCase()] ?? "application/octet-stream";
export async function assetStore(
  spec = process.env.MOLNOTES_ASSET_STORE ?? "r2",
) {
  if (spec === "r2") return storage();
  if (!spec.startsWith("dir:") || !spec.slice(4))
    throw new Error("MOLNOTES_ASSET_STORE must be r2 or dir:<path>");
  const root = spec.slice(4);
  const path = (key) => {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("Invalid asset hash");
    return join(root, key);
  };
  return {
    fetchObject: (key) => readFile(path(key)),
    async hasObject(key) {
      try {
        await stat(path(key));
        return true;
      } catch (error) {
        if (error.code === "ENOENT") return false;
        throw error;
      }
    },
    async putObject(key, bytes) {
      if (sha256(bytes) !== key) throw new Error("Asset hash mismatch");
      await mkdir(root, { recursive: true });
      await writeFile(path(key), bytes);
    },
  };
}

// Store identity and absolute cache path prevent one backend from owning another's flight.
const caches = new WeakMap();
export async function cachedAsset(store, cache, asset) {
  let state = caches.get(store);
  if (!state) {
    state = { flights: new Map(), verified: new Map() };
    caches.set(store, state);
  }
  const file = resolve(cache, asset.sha256);
  const key = `${file}:${asset.size}`;
  if (state.flights.has(key)) return state.flights.get(key);
  const identity = (info) =>
    [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].join(":");
  const pending = (async () => {
    try {
      const info = await stat(file, { bigint: true });
      if (info.isFile() && info.size === BigInt(asset.size)) {
        const signature = identity(info);
        if (state.verified.get(key) === signature) return file;
        const hash = createHash("sha256");
        for await (const chunk of createReadStream(file)) hash.update(chunk);
        const after = await stat(file, { bigint: true });
        if (
          signature === identity(after) &&
          hash.digest("hex") === asset.sha256
        ) {
          state.verified.set(key, signature);
          return file;
        }
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    state.verified.delete(key);
    const bytes = await store.fetchObject(asset.sha256);
    if (bytes.length !== Number(asset.size) || sha256(bytes) !== asset.sha256)
      throw new Error("Asset integrity check failed");
    await mkdir(cache, { recursive: true });
    const temporary = `${file}.${randomUUID()}`;
    try {
      await writeFile(temporary, bytes);
      await rename(temporary, file);
    } finally {
      await rm(temporary, { force: true });
    }
    state.verified.set(key, identity(await stat(file, { bigint: true })));
    return file;
  })();
  state.flights.set(key, pending);
  try {
    return await pending;
  } finally {
    state.flights.delete(key);
  }
}

/** Invalid or multiple ranges are ignored; a valid but empty selection is unsatisfiable. */
export function byteRange(header, size) {
  if (!header) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return undefined;
  let start, end;
  if (!match[1]) {
    const count = Number(match[2]);
    start = Math.max(0, size - count);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  }
  return start > end || start >= size ? null : { start, end };
}
