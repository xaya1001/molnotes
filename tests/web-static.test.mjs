import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWebServer } from "../server/web.mjs";

test("static WebAssembly supports streaming with the wasm MIME type", async () => {
  const dist = await mkdtemp(join(tmpdir(), "il-wasm-test-"));
  const bytes = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
  const server = createWebServer({ dist });
  try {
    await writeFile(join(dist, "RDKit.wasm"), bytes);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const url = `http://127.0.0.1:${server.address().port}/RDKit.wasm`;
    for (const method of ["GET", "HEAD"]) {
      const response = await fetch(url, { method });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "application/wasm");
      assert.deepEqual(
        Buffer.from(await response.arrayBuffer()),
        method === "GET" ? bytes : Buffer.alloc(0),
      );
    }
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(dist, { recursive: true, force: true });
  }
});

test("asset HTTP methods, byte ranges, validators and aborted streams", async () => {
  const { sha256 } = await import("../server/assets.mjs");
  const cache = await mkdtemp(join(tmpdir(), "il-hardening-http-"));
  const bytes = Buffer.alloc(2_000_000, 65);
  bytes.write("0123456789");
  const asset = {
    sha256: sha256(bytes),
    size: bytes.length,
    content_type: "video/mp4",
  };
  let fetches = 0;
  const server = createWebServer({
    pool: { query: async () => ({ rows: [asset] }) },
    store: {
      fetchObject: async () => {
        fetches++;
        return bytes;
      },
    },
    cache,
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}/sites/test/static/movie.mp4`;
  const tag = `"${asset.sha256}"`;
  try {
    const post = await fetch(url, { method: "POST" });
    assert.equal(post.status, 405);
    assert.equal(fetches, 0);
    const head = await fetch(url, {
      method: "HEAD",
      headers: { Range: "bytes=0-3" },
    });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get("content-length"), String(bytes.length));
    assert.equal((await head.arrayBuffer()).byteLength, 0);
    assert.equal(fetches, 0);
    for (const [range, start, end] of [
      ["bytes=1-3", 1, 3],
      ["bytes=1999997-", 1999997, 1999999],
      ["bytes=-4", 1999996, 1999999],
    ]) {
      const response = await fetch(url, {
        headers: { Range: range, "If-Range": tag },
      });
      assert.equal(response.status, 206);
      assert.equal(
        response.headers.get("content-range"),
        `bytes ${start}-${end}/${bytes.length}`,
      );
      assert.deepEqual(
        Buffer.from(await response.arrayBuffer()),
        bytes.subarray(start, end + 1),
      );
    }
    assert.equal(fetches, 1);
    const invalid = await fetch(url, { headers: { Range: "bytes=2000000-" } });
    assert.equal(invalid.status, 416);
    assert.equal(
      invalid.headers.get("content-range"),
      `bytes */${bytes.length}`,
    );
    for (const headers of [
      { Range: "bytes=1-3", "If-Range": '"old"' },
      { Range: "bytes=1-3,7-8" },
      { Range: "nonsense" },
    ]) {
      const response = await fetch(url, { headers });
      assert.equal(response.status, 200);
      assert.equal((await response.arrayBuffer()).byteLength, bytes.length);
    }
    assert.equal(
      (await fetch(url, { headers: { "If-None-Match": `W/${tag}` } })).status,
      304,
    );
    const controller = new AbortController();
    const response = await fetch(url, { signal: controller.signal });
    const reader = response.body.getReader();
    await reader.read();
    controller.abort();
    await reader.cancel().catch(() => {});
    const after = await fetch(url, { headers: { Range: "bytes=0-9" } });
    assert.equal(await after.text(), "0123456789");
    assert.equal(fetches, 1);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(cache, { recursive: true, force: true });
  }
});

test("notebook metadata cache does not read topics or build the search index", async () => {
  let reads = 0;
  const query = async (sql) => {
    if (sql === "SELECT revision FROM content_revision")
      return { rows: [{ revision: 1 }] };
    if (
      [
        "BEGIN",
        "COMMIT",
        "ROLLBACK",
        "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ",
      ].includes(sql)
    )
      return { rows: [] };
    if (sql.includes("FROM note_directories")) {
      reads++;
      return {
        rows: [
          {
            compiled: {
              slug: "book",
              path: "/notes/book/",
              title: "Book",
              summary: "Summary",
              order: 1,
            },
          },
        ],
      };
    }
    if (sql.includes("FROM notes"))
      return {
        rows: [
          {
            compiled: {
              slug: "one",
              directory: "book",
              path: "/notes/book/one",
              title: "One",
              summary: "Summary",
              order: 1,
            },
          },
        ],
      };
    throw new Error("unrelated content unavailable");
  };
  const server = createWebServer({
    pool: { query, connect: async () => ({ query, release() {} }) },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (let i = 0; i < 2; i++) {
      const response = await fetch(base + "/api/notes");
      assert.equal(response.status, 200);
      const notebook = await response.json();
      assert.equal(notebook.notes[0].path, "/notes/book/one");
      assert.ok(!("html" in notebook.notes[0]));
    }
    assert.equal(reads, 1);
    assert.equal((await fetch(base + "/api/index")).status, 503);
    assert.equal((await fetch(base + "/api/notes")).status, 200);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
