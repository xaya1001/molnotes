import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256 } from "../../shared/assets.ts";

export interface AssetFile {
  file: string;
}
export type AssetBytes = Buffer | AssetFile;

/** Frozen, deduplicated bytes owned by one build, never the mutable source. */
export async function assetStage() {
  const directory = await mkdtemp(join(tmpdir(), "molnotes-assets-"));
  const files = new Map<string, Promise<AssetFile>>();
  return {
    save(bytes: Buffer, hash: string) {
      if (!files.has(hash)) {
        const file = join(directory, hash);
        files.set(
          hash,
          writeFile(file, bytes).then(() => ({ file })),
        );
      }
      return files.get(hash)!;
    },
    get: (hash: string) => files.get(hash),
    dispose: () => rm(directory, { recursive: true, force: true }),
  };
}
export type AssetStage = Awaited<ReturnType<typeof assetStage>>;

export async function assetResource(bytes: Buffer, stage?: AssetStage) {
  const hash = sha256(bytes);
  return {
    sha256: hash,
    size: bytes.length,
    bytes: stage ? await stage.save(bytes, hash) : bytes,
  };
}
