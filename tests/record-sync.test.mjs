import test from "node:test";
import assert from "node:assert/strict";
import { mergeRecords } from "../src/ui/record-sync.ts";
test("merges independent leaves, membership changes and intentional deletions", () => {
  const base = {
    complete: ["a"],
    bookmarks: ["a"],
    notes: { a: "old" },
    reading: { opened: 1, read: false },
  };
  const local = {
    ...base,
    complete: [],
    notes: {},
    reading: { opened: 2, read: false },
  };
  const remote = {
    ...base,
    complete: ["a", "b"],
    bookmarks: [],
    reading: { opened: 1, read: true },
  };
  assert.deepEqual(mergeRecords(base, local, remote), {
    complete: ["b"],
    bookmarks: [],
    notes: {},
    reading: { opened: 2, read: true },
  });
  assert.throws(
    () =>
      mergeRecords(
        { notes: { a: "old" } },
        { notes: { a: "mine" } },
        { notes: { a: "theirs" } },
      ),
    /conflict/,
  );
});

test("two clients merge through conditional HTTP, retain conflict input, and explicitly resolve against latest", async () => {
  const { recordSync } = await import("../src/ui/record-sync.ts");
  const original = globalThis.fetch;
  let document = {
      notes: { a: "old" },
      complete: [],
      bookmarks: [],
      reading: { opened: 1, read: false },
    },
    version = 1;
  const writes = [];
  globalThis.fetch = async (_, options = {}) => {
    if (options.method === "PUT") {
      writes.push(JSON.parse(options.body));
      if (options.headers["If-Match"] !== `"${version}"`)
        return new Response("{}", { status: 412 });
      document = JSON.parse(options.body);
      version++;
    }
    return Response.json(document, { headers: { ETag: `"${version}"` } });
  };
  try {
    const a = recordSync("/records"),
      b = recordSync("/records");
    const av = await a.load(),
      bv = await b.load();
    av.reading.opened = 2;
    av.complete = ["a"];
    await a.save(av);
    bv.reading.read = true;
    bv.complete = ["b"];
    const merged = await b.save(bv);
    assert.deepEqual(merged.complete, ["b", "a"]);
    assert.deepEqual(merged.reading, { opened: 2, read: true });
    const c = recordSync("/records"),
      d = recordSync("/records");
    const cv = await c.load(),
      dv = await d.load();
    cv.notes.a = "theirs";
    await c.save(cv);
    dv.notes.a = "mine";
    await assert.rejects(d.save(dv), /conflict/);
    assert.equal(dv.notes.a, "mine");
    assert.equal(document.notes.a, "theirs");
    const e = recordSync("/records"),
      ev = await e.load();
    ev.bookmarks = ["b"];
    await e.save(ev);
    const resolved = await d.save(dv, true);
    assert.equal(resolved.notes.a, "mine");
    assert.deepEqual(resolved.bookmarks, ["b"]);
    assert.equal(writes.at(-1).notes.a, "mine");
  } finally {
    globalThis.fetch = original;
  }
});

test("deferred successful save retains pending input and unrelated merged fields before explicit conflict resolution", async () => {
  const { recordSync } = await import("../src/ui/record-sync.ts");
  const original = globalThis.fetch;
  let remote = { notes: { a: "old", b: "old" }, bookmarks: [] },
    version = 1,
    release,
    entered;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const waiting = new Promise((resolve) => {
    entered = resolve;
  });
  let hold = true;
  globalThis.fetch = async (_, options = {}) => {
    if (options.method === "PUT") {
      if (options.headers["If-Match"] !== `"${version}"`)
        return new Response("{}", { status: 412 });
      remote = JSON.parse(options.body);
      version++;
      const result = Response.json(remote, {
        headers: { etag: `"${version}"` },
      });
      if (hold) {
        entered();
        await gate;
        hold = false;
      }
      return result;
    }
    return Response.json(remote, { headers: { etag: `"${version}"` } });
  };
  try {
    const sync = recordSync("/records");
    let current = await sync.load();
    remote = { notes: { a: "remote", b: "remote unrelated" }, bookmarks: [] };
    version++;
    current.bookmarks = ["a"];
    const pending = sync.save(structuredClone(current), false, () =>
      structuredClone(current),
    );
    await waiting;
    current.notes.a = "typed during save";
    release();
    current = await pending;
    assert.deepEqual(current, {
      notes: { a: "typed during save", b: "remote unrelated" },
      bookmarks: ["a"],
    });
    assert.equal(sync.conflicted, true);
    await assert.rejects(sync.save(current), /conflict/);
    await sync.save(current, true);
    assert.equal(remote.notes.a, "typed during save");
    assert.equal(remote.notes.b, "remote unrelated");
  } finally {
    release();
    globalThis.fetch = original;
  }
});

test("a response rejected by the current content codec does not advance the client baseline", async () => {
  const { recordSync } = await import("../src/ui/record-sync.ts");
  const original = globalThis.fetch;
  let version = 1,
    invalid = false,
    document = { notes: { a: "old" } };
  const conditions = [];
  globalThis.fetch = async (_, options = {}) => {
    if (options.method === "PUT") {
      conditions.push(options.headers["If-Match"]);
      if (options.headers["If-Match"] !== `"${version}"`)
        return new Response("{}", { status: 412 });
      document = JSON.parse(options.body);
      version++;
    }
    return Response.json(
      invalid ? { ...document, removedChapter: true } : document,
      { headers: { etag: `"${version}"` } },
    );
  };
  try {
    const sync = recordSync("/records", (value) => {
      if (value.removedChapter) throw new Error("content changed");
    });
    const local = await sync.load();
    local.notes.a = "local";
    invalid = true;
    await assert.rejects(sync.save(local), /content changed/);
    invalid = false;
    await sync.save(local);
    assert.deepEqual(conditions.slice(0, 2), ['"1"', '"1"']);
    assert.equal(document.notes.a, "local");
  } finally {
    globalThis.fetch = original;
  }
});

test("pending drafts survive reload, merge remote edits, and retain conflicts until explicit resolution", async () => {
  const { recordSync } = await import("../src/ui/record-sync.ts");
  const items = new Map();
  const storage = {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => items.set(key, value),
    removeItem: (key) => items.delete(key),
  };
  const original = globalThis.fetch;
  let remote = { notes: { a: "old" }, bookmarks: [] },
    version = 1;
  globalThis.fetch = async (_, options = {}) => {
    if (options.method === "PUT") {
      assert.equal(options.headers["If-Match"], `"${version}"`);
      remote = JSON.parse(options.body);
      version++;
    }
    return Response.json(remote, { headers: { ETag: `"${version}"` } });
  };
  try {
    const first = recordSync("/records", undefined, storage);
    const local = await first.load();
    local.notes.a = "pending";
    first.stage(local);
    remote.bookmarks = ["b"];
    version++;
    const restored = recordSync("/records", undefined, storage);
    const recovered = await restored.load();
    assert.deepEqual(recovered, { notes: { a: "pending" }, bookmarks: ["b"] });
    assert.equal(restored.pending, true);
    await restored.save(recovered);
    assert.equal(items.size, 0);
    recovered.notes.a = "local conflict";
    restored.stage(recovered);
    remote.notes.a = "remote conflict";
    version++;
    for (let i = 0; i < 2; i++) {
      const reload = recordSync("/records", undefined, storage);
      const value = await reload.load();
      assert.equal(value.notes.a, "local conflict");
      assert.equal(reload.conflicted, true);
      await assert.rejects(reload.save(value), /conflict/);
      if (i === 1) await reload.save(value, true);
    }
    assert.equal(remote.notes.a, "local conflict");
    assert.equal(items.size, 0);
  } finally {
    globalThis.fetch = original;
  }
});
