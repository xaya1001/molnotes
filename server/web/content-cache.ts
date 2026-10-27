import { readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import {
  measureStage,
  logTiming,
  type StageTiming,
} from "../../shared/stage-timing.ts";
import type { Snapshot, SnapshotAsset } from "../../shared/snapshot.ts";

export type LoadedSnapshot = Awaited<ReturnType<typeof loadSnapshot>>;

const families: Record<string, string> = {
  "/api/catalog": "catalog",
  "/api/index": "index",
  "/api/review": "review",
  "/api/notes": "notebook",
  "/api/glossary": "glossary",
};
const family = (key: string) =>
  key.startsWith("/api/topics/")
    ? "topic"
    : key.startsWith("/api/notes/")
      ? "note"
      : (families[key] ?? "other");

async function loadSnapshot(
  root: string,
  report: (event: StageTiming) => void,
) {
  // Written by the content build; the format check below is its boundary.
  const data: Snapshot = JSON.parse(
    await readFile(join(root, "snapshot.json"), "utf8"),
  );
  if (data?.format !== 1) throw new Error("unsupported snapshot format");
  const topics = new Map(data.topics.map((t) => [t.slug, t]));
  const directories = new Map(data.directories.map((d) => [d.dir, d]));
  const notes = new Map(
    data.notes.filter((n) => !n.author).map((n) => [`${n.dir}/${n.slug}`, n]),
  );
  const assets = new Map(data.assets.map((a) => [`${a.scope}/${a.path}`, a]));
  const entries = new Map<string, Promise<unknown>>();
  return {
    root,
    topics: data.topics,
    directories: data.directories,
    notes: data.notes,
    glossary: data.glossary,
    topic: (slug: string) => topics.get(slug),
    directory: (dir: string) => directories.get(dir),
    note: (dir: string, slug: string) => notes.get(`${dir}/${slug}`),
    asset: (scope: string, path: string) => assets.get(`${scope}/${path}`),
    file: (asset: SnapshotAsset) =>
      join(root, "files", asset.scope, asset.path),
    /** A response built once per snapshot; a failed or empty build is retried. */
    cached<T>(key: string, build: () => Promise<T> | T): Promise<T> {
      let entry = entries.get(key) as Promise<T> | undefined;
      if (!entry) {
        const built = measureStage(`query.build.${family(key)}`, build, report);
        entries.set(key, built);
        built.then(
          (value) => value || entries.delete(key),
          () => entries.delete(key),
        );
        entry = built;
      }
      return entry;
    },
  };
}

/**
 * The snapshot `path` resolves to, held in memory. Each call follows the link
 * again and loads a new target first; a target that fails to load is reported
 * once and the previous snapshot keeps serving. Without any loaded snapshot
 * the call rejects.
 */
export function contentSnapshot(
  path: string,
  report: (event: StageTiming) => void = logTiming,
) {
  let current: LoadedSnapshot | null = null;
  let failed: string | null | undefined = null;
  let loading: { root: string; promise: Promise<void> } | null = null;
  return async function snapshot(): Promise<LoadedSnapshot> {
    let root: string;
    try {
      root = await realpath(path);
    } catch (error) {
      if (!current) throw error;
      const { code } = error as NodeJS.ErrnoException;
      if (failed !== code) console.error(`Content snapshot ${path}: ${code}`);
      failed = code;
      return current;
    }
    if (root === current?.root) return current;
    if (root === failed) {
      if (current) return current;
      throw new Error("No content snapshot");
    }
    if (loading?.root !== root) {
      const pending: { root: string; promise: Promise<void> } = {
        root,
        promise: loadSnapshot(root, report).then(
          (loaded) => {
            if (loading !== pending) return;
            current = loaded;
            failed = null;
          },
          (error) => {
            if (loading !== pending) return;
            failed = root;
            console.error(`Content snapshot ${root}: ${error.message}`);
          },
        ),
      };
      loading = pending;
      pending.promise.finally(() => {
        if (loading === pending) loading = null;
      });
    }
    await loading!.promise;
    if (!current) throw new Error("No content snapshot");
    return current;
  };
}
