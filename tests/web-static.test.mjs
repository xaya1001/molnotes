import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import {
  mkdir,
  mkdtemp,
  writeFile,
  rm,
  rename,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWebServer } from "../server/web.mjs";
import { sha256 } from "../server/assets.mjs";
import { openRecords } from "../server/records.mjs";

/** Writes a snapshot directory `name` under `root` from table rows and files. */
async function snapshot(root, name, data = {}, files = {}) {
  const directory = join(root, name);
  await mkdir(directory, { recursive: true });
  const assets = [];
  for (const [key, bytes] of Object.entries(files)) {
    const [scope, path] = [
      key.split("/").slice(0, 2).join("/"),
      key.split("/").slice(2).join("/"),
    ];
    await mkdir(join(directory, "files", scope, path, ".."), {
      recursive: true,
    });
    await writeFile(join(directory, "files", key), bytes);
    assets.push({
      scope,
      path,
      sha256: sha256(bytes),
      size: bytes.length,
      content_type: "video/mp4",
    });
  }
  await writeFile(
    join(directory, "snapshot.json"),
    JSON.stringify({
      format: 1,
      commit: "0".repeat(40),
      builtAt: "2026-01-01T00:00:00.000Z",
      topics: [],
      directories: [],
      notes: [],
      glossary: [],
      registry: null,
      assets,
      ...data,
    }),
  );
}
async function point(root, name) {
  await symlink(name, join(root, "next"));
  await rename(join(root, "next"), join(root, "current"));
}
async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${server.address().port}`;
}
async function stop(server) {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}

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
  const root = await mkdtemp(join(tmpdir(), "il-hardening-http-"));
  const bytes = Buffer.alloc(2_000_000, 65);
  bytes.write("0123456789");
  await snapshot(root, "one", {}, { "sites/test/static/movie.mp4": bytes });
  await point(root, "one");
  const server = createWebServer({ snapshot: join(root, "current") });
  const url = (await listen(server)) + "/sites/test/static/movie.mp4";
  const tag = `"${sha256(bytes)}"`;
  try {
    const post = await fetch(url, { method: "POST" });
    assert.equal(post.status, 405);
    const head = await fetch(url, {
      method: "HEAD",
      headers: { Range: "bytes=0-3" },
    });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get("content-length"), String(bytes.length));
    assert.equal(head.headers.get("content-type"), "video/mp4");
    assert.equal(head.headers.get("etag"), tag);
    assert.equal((await head.arrayBuffer()).byteLength, 0);
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
    // Only files the snapshot lists are served.
    await writeFile(join(root, "one/files/sites/test/static/extra.mp4"), "x");
    assert.equal((await fetch(url.replace("movie", "extra"))).status, 404);
  } finally {
    await stop(server);
    await rm(root, { recursive: true, force: true });
  }
});

test("a new snapshot target is served from the next request; a broken one keeps the previous", async () => {
  const root = await mkdtemp(join(tmpdir(), "il-snapshot-switch-"));
  const directory = (title) => ({
    directories: [
      {
        dir: "book",
        metadata: { title, order: 1, intro: "" },
        citations: {},
        compiled: {
          slug: "book",
          path: "/notes/book/",
          title,
          order: 1,
          html: "",
        },
      },
    ],
  });
  const errors = [];
  const error = console.error;
  console.error = (message) => errors.push(message);
  const server = createWebServer({
    records: openRecords(":memory:"),
    snapshot: join(root, "current"),
  });
  const base = await listen(server);
  const title = async () =>
    (await (await fetch(base + "/api/notes")).json()).directories[0].title;
  try {
    assert.equal((await fetch(base + "/healthz")).status, 503);
    assert.equal((await fetch(base + "/api/notes")).status, 503);
    await mkdir(join(root, "empty"));
    await point(root, "empty");
    assert.equal((await fetch(base + "/healthz")).status, 503);
    await snapshot(root, "one", directory("First"));
    await point(root, "one");
    assert.equal((await fetch(base + "/healthz")).status, 200);
    assert.equal(await title(), "First");
    await snapshot(root, "two", directory("Second"));
    await point(root, "two");
    assert.equal(await title(), "Second");
    await mkdir(join(root, "broken"));
    await writeFile(join(root, "broken/snapshot.json"), "{");
    await point(root, "broken");
    assert.equal(await title(), "Second");
    assert.equal(await title(), "Second");
    assert.equal((await fetch(base + "/healthz")).status, 200);
    assert.equal(errors.filter((e) => e.includes("broken")).length, 1);
    await point(root, "one");
    assert.equal(await title(), "First");
  } finally {
    console.error = error;
    await stop(server);
    await rm(root, { recursive: true, force: true });
  }
});

test("notebook metadata leaves out bodies and is built once per snapshot", async () => {
  const root = await mkdtemp(join(tmpdir(), "il-notebook-cache-"));
  await snapshot(root, "one", {
    directories: [
      {
        dir: "book",
        metadata: { title: "Book", order: 1, intro: "" },
        citations: {},
        compiled: {
          slug: "book",
          path: "/notes/book/",
          title: "Book",
          summary: "Summary",
          order: 1,
          html: "<p>intro</p>",
        },
      },
    ],
    notes: [
      {
        dir: "book",
        slug: "one",
        author: false,
        source: "",
        compiled: {
          slug: "one",
          directory: "book",
          path: "/notes/book/one",
          title: "One",
          summary: "Summary",
          order: 1,
          html: "<p>body</p>",
        },
      },
    ],
  });
  await point(root, "one");
  const events = [];
  const timings = process.env.MOLNOTES_TIMINGS;
  const error = console.error;
  process.env.MOLNOTES_TIMINGS = "1";
  console.error = (line) => events.push(JSON.parse(line));
  const server = createWebServer({ snapshot: join(root, "current") });
  const base = await listen(server);
  try {
    for (let i = 0; i < 2; i++) {
      const response = await fetch(base + "/api/notes");
      assert.equal(response.status, 200);
      const notebook = await response.json();
      assert.equal(notebook.notes[0].path, "/notes/book/one");
      assert.ok(!("html" in notebook.notes[0]));
      assert.ok(!("html" in notebook.directories[0]));
    }
    assert.deepEqual(
      events.map((e) => e.stage),
      ["query.build.notebook"],
    );
  } finally {
    console.error = error;
    if (timings === undefined) delete process.env.MOLNOTES_TIMINGS;
    else process.env.MOLNOTES_TIMINGS = timings;
    await stop(server);
    await rm(root, { recursive: true, force: true });
  }
});
