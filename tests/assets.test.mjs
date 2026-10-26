import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cachedAsset, sha256 } from "../server/assets.mjs";
test("deduplicates cold downloads, verifies corruption and retries failures", async () => {
  const cache = await mkdtemp(join(tmpdir(), "il-hardening-assets-"));
  const bytes = Buffer.from("verified asset");
  const asset = { sha256: sha256(bytes), size: bytes.length };
  let calls = 0,
    fail = false;
  const store = {
    async fetchObject() {
      calls++;
      await new Promise((resolve) => setImmediate(resolve));
      if (fail) throw new Error("offline");
      return bytes;
    },
  };
  try {
    const files = await Promise.all(
      Array.from({ length: 8 }, () => cachedAsset(store, cache, asset)),
    );
    assert.equal(calls, 1);
    assert.deepEqual(await readFile(files[0]), bytes);
    await cachedAsset(store, cache, asset);
    assert.equal(calls, 1);
    await writeFile(files[0], Buffer.alloc(bytes.length));
    await cachedAsset(store, cache, asset);
    assert.equal(calls, 2);
    await rm(files[0]);
    fail = true;
    await assert.rejects(cachedAsset(store, cache, asset), /offline/);
    fail = false;
    await cachedAsset(store, cache, asset);
    assert.equal(calls, 4);
    const other = { fetchObject: async () => Buffer.from("wrong") };
    await assert.rejects(
      cachedAsset(other, join(cache, "other"), asset),
      /integrity/,
    );
  } finally {
    await rm(cache, { recursive: true, force: true });
  }
});

test(
  "in-flight ownership is isolated by store identity and cache directory",
  { timeout: 5000 },
  async (t) => {
    const cache = await mkdtemp(join(tmpdir(), "il-hardening-isolation-"));
    const bytes = Buffer.from("isolated");
    const asset = { sha256: sha256(bytes), size: bytes.length };
    let calls = 0,
      release,
      entered;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const allEntered = new Promise((resolve) => {
      entered = resolve;
    });
    const fetchObject = async () => {
      calls++;
      if (calls === 3) entered();
      await gate;
      return bytes;
    };
    const store = { fetchObject },
      other = { fetchObject };
    const requests = [
      cachedAsset(store, join(cache, "one"), asset),
      cachedAsset(store, join(cache, "two"), asset),
      cachedAsset(other, join(cache, "one"), asset),
    ];
    t.after(async () => {
      release();
      await Promise.allSettled(requests);
      await rm(cache, { recursive: true, force: true });
    });
    await allEntered;
    release();
    const paths = await Promise.all(requests);
    assert.equal(calls, 3);
    assert.equal(new Set(paths).size, 2);
  },
);
