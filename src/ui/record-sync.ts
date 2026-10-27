import type { Unchecked } from "../../shared/unchecked.ts";
const equal = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const conflictMessage =
  "conflict: 同一项记录已在其他页面修改。当前输入仍保留，请核对后再保存。";
const object = (v: unknown) =>
  v !== null && typeof v === "object" && !Array.isArray(v);
/** Three-way merge; only chapter membership arrays have set semantics. */
export function mergeRecords<T>(
  base: T | undefined,
  local: T,
  remote: T,
  key?: string,
  resolve?: boolean,
): T;
// Records are JSON documents, merged field by field.
export function mergeRecords(
  base: Unchecked,
  local: Unchecked,
  remote: Unchecked,
  key = "",
  resolve = false,
): Unchecked {
  if (key === "recent" && object(local) && object(remote))
    return local.opened >= remote.opened ? local : remote;
  if (equal(local, base)) return remote;
  if (equal(remote, base) || equal(local, remote)) return local;
  if (
    ["complete", "bookmarks"].includes(key) &&
    [base, local, remote].every(Array.isArray)
  ) {
    return [...new Set([...base, ...local, ...remote])].filter((id) =>
      local.includes(id) === base.includes(id)
        ? remote.includes(id)
        : local.includes(id),
    );
  }
  if (object(local) && object(remote) && (base === undefined || object(base))) {
    const result: Record<string, unknown> = {};
    for (const field of new Set([
      ...Object.keys(base ?? {}),
      ...Object.keys(local),
      ...Object.keys(remote),
    ])) {
      const value = mergeRecords(
        base?.[field],
        local[field],
        remote[field],
        field,
        resolve,
      );
      if (value !== undefined) result[field] = value;
    }
    return result;
  }
  if (resolve) return local;
  throw new Error(conflictMessage);
}
class RecordRequestError extends Error {
  status: number;
  constructor(status: number) {
    super(`记录请求失败（${status}）`);
    this.status = status;
  }
}

/** A snapshot and its server validator move together only after a successful save. */
export function recordSync<T>(
  endpoint: string,
  validate: (document: T) => void = () => {},
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">,
) {
  let base: T | undefined,
    etag: string | null = null,
    conflicted = false;
  const key = `molnotes/pending:${endpoint}`;
  let pending = false;
  function stage(document: T) {
    if (!storage) return;
    validate(document);
    storage.setItem(key, JSON.stringify({ base, document, conflicted }));
    pending = true;
  }
  async function request(
    options: RequestInit & { body?: string },
  ): Promise<{ document: T; etag: string | null }> {
    if (options.method === "PUT")
      options.keepalive =
        new TextEncoder().encode(options.body).byteLength <= 60_000;
    const response = await fetch(endpoint, options);
    if (!response.ok) throw new RecordRequestError(response.status);
    return {
      document: await response.json(),
      etag: response.headers.get("etag"),
    };
  }
  return {
    async load(): Promise<T> {
      const value = await request({ cache: "no-store" });
      validate(value.document);
      base = value.document;
      etag = value.etag;
      conflicted = false;
      const saved = storage?.getItem(key) ?? null;
      pending = saved !== null;
      if (saved !== null) {
        const draft = JSON.parse(saved);
        validate(draft.base);
        validate(draft.document);
        let merged: T;
        try {
          merged = mergeRecords(draft.base, draft.document, base);
          conflicted = draft.conflicted === true;
        } catch {
          merged = mergeRecords(draft.base, draft.document, base, "", true);
          conflicted = true;
        }
        validate(merged);
        stage(merged);
        return structuredClone(merged);
      }
      return structuredClone(base);
    },
    stage,
    get pending() {
      return pending;
    },
    get conflicted() {
      return conflicted;
    },
    async save(local: T, resolve = false, current = () => local): Promise<T> {
      if (conflicted && !resolve) throw new Error(conflictMessage);
      let candidate = local,
        expected = etag;
      if (resolve) {
        const latest = await request({ cache: "no-store" });
        candidate = mergeRecords(base, local, latest.document, "", true);
        expected = latest.etag;
      }
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const value = await request({
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              "If-Match": String(expected),
            },
            body: JSON.stringify(candidate),
          });
          let rebased;
          conflicted = false;
          try {
            rebased = mergeRecords(local, current(), value.document);
          } catch {
            rebased = mergeRecords(local, current(), value.document, "", true);
            conflicted = true;
          }
          validate(rebased);
          base = value.document;
          etag = value.etag;
          if (equal(rebased, value.document) && !conflicted) {
            storage?.removeItem(key);
            pending = false;
          } else stage(rebased);
          return structuredClone(rebased);
        } catch (error) {
          if (!(error instanceof RecordRequestError) || error.status !== 412)
            throw error;
          const latest = await request({ cache: "no-store" });
          try {
            candidate = mergeRecords(base, local, latest.document, "", resolve);
          } catch (cause) {
            conflicted = true;
            stage(current());
            throw cause;
          }
          expected = latest.etag;
        }
      }
      throw new Error("记录持续变化，请重试。当前输入仍保留。");
    },
  };
}
