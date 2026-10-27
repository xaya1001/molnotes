import test from "node:test";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, cp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { buildSnapshot } from "../server/content-publish.mjs";
import { writeSnapshot } from "../server/content-snapshot.mjs";
import { allRecords, openRecords, readRecord } from "../server/records.mjs";
import { createWebServer } from "../server/web.mjs";
import { publishSnapshot } from "./helpers/content-snapshot.mjs";

const shelf = (root) => ({
  materials: resolve("tests/fixtures/shelf"),
  cache: join(root, "shelf-cache"),
});
/** A copy of the fixture content holding only `units`. */
async function fixtureContent(root, units) {
  const content = join(root, "content");
  await cp(resolve("tests/fixtures/content"), content, {
    recursive: true,
    filter: (source) => {
      const [kind, name] = source
        .slice(resolve("tests/fixtures/content").length + 1)
        .split("/");
      return !name || !["sites", "notes"].includes(kind)
        ? true
        : units.includes(`${kind}/${name}`);
    },
  });
  return content;
}
/** Builds `content` and points `releases/current` at it; returns the snapshot. */
async function serve(content, releases, options) {
  let snapshot;
  await publishSnapshot(releases, async (directory) => {
    const built = await buildSnapshot(content, options);
    await writeSnapshot(directory, built);
    snapshot = built.snapshot;
  });
  return snapshot;
}

test("published content, records and HTTP assets", async () => {
  const root = await mkdtemp(join(tmpdir(), "il-content-test-"));
  const records = openRecords(join(root, "records.sqlite"));
  const content = await fixtureContent(root, [
    "sites/sample",
    "sites/instruments",
    "notes/reader-test",
  ]);
  const releases = join(root, "releases");
  const server = createWebServer({
    records,
    snapshot: join(releases, "current"),
  });
  try {
    const prompt = "notes/reader-test/prompts/sample.svg.md";
    const original = await readFile(
      join(content, "notes/reader-test/first.md"),
      "utf8",
    );
    const snapshot = await serve(content, releases);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}`;
    const call = (path, options) => fetch(base + path, options);
    assert.equal((await call("/healthz")).status, 200);
    const reviewMetadata = await (await call("/api/review")).json();
    const searchIndex = await (await call("/api/index")).json();
    assert.deepEqual(reviewMetadata.chapters, searchIndex.chapters);
    assert.deepEqual(reviewMetadata.quiz, searchIndex.quiz);
    assert.deepEqual(Object.keys(reviewMetadata).sort(), ["chapters", "quiz"]);

    // A topic declares its group; notebooks name the practice topics their notes link to.
    const catalog = await (await call("/api/catalog")).json();
    assert.deepEqual(
      catalog.sites.map((site) => [site.slug, site.group]),
      [
        ["sample", "练习"],
        ["instruments", "谱图"],
      ],
    );
    assert.deepEqual(
      catalog.sites.find((site) => site.slug === "sample").chapterIds,
      ["start", "next"],
    );
    assert.equal(catalog.groups.at(-1), "练习");
    assert.ok(
      catalog.directories.every(
        (directory) =>
          !["intro", "html", "citations"].some((key) => key in directory),
      ),
    );
    assert.deepEqual(
      catalog.directories.map((d) => [d.slug, d.practice]),
      [["reader-test", ["sample"]]],
    );
    const index = await call("/api/notes", {
      headers: { "Accept-Encoding": "gzip, br" },
    });
    assert.equal(index.status, 200);
    assert.equal(
      (
        await call("/api/notes", {
          headers: { "If-None-Match": index.headers.get("etag") },
        })
      ).status,
      304,
    );
    await writeFile(
      join(content, "notes/reader-test/first.md"),
      original + "\n重新发布后的段落。\n",
    );
    await serve(content, releases);
    const notebook = await (await call("/api/notes")).json();
    assert.ok(
      notebook.notes.every(
        (note) =>
          !["html", "text", "sections", "molecules", "citations"].some(
            (key) => key in note,
          ),
      ),
    );
    assert.ok(
      notebook.directories.every(
        (dir) => !["html", "intro", "citations"].some((key) => key in dir),
      ),
    );
    assert.match(
      (await (await call("/api/notes/reader-test/first")).json()).html,
      /重新发布后的段落/,
    );
    // Reader APIs expose notes; author material remains available to editors.
    assert.deepEqual(
      notebook.notes.map((note) => note.path),
      ["/notes/reader-test/first", "/notes/reader-test/second"],
    );
    assert.deepEqual(Object.keys(notebook).sort(), ["directories", "notes"]);
    const planHtml = snapshot.notes.find(
      (note) => note.author && note.slug === "plan",
    ).compiled.html;
    for (const href of [
      'href="/notes/reader-test/first"',
      'href="/notes/reader-test/author/conventions"',
      'data-image="/notes/reader-test/assets/sample.svg"',
    ])
      assert.ok(planHtml.includes(href), href);
    assert.deepEqual(
      (await (await call("/api/index")).json()).notesSearch.notes.map(
        (note) => note.path,
      ),
      ["/notes/reader-test/first", "/notes/reader-test/second"],
    );
    const asset = await call("/notes/reader-test/assets/sample.svg");
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get("etag"), /^"[a-f0-9]{64}"$/);
    assert.equal(
      (
        await call("/notes/reader-test/assets/sample.svg", {
          headers: { "If-None-Match": asset.headers.get("etag") },
        })
      ).status,
      304,
    );
    assert.equal(
      (await call("/notes/reader-test/assets/missing.svg")).status,
      404,
    );
    assert.equal((await call("/" + prompt)).status, 404);
    const record = await (await call("/api/records/topics/sample")).json();
    const initialTag = (await call("/api/records/topics/sample")).headers.get(
      "etag",
    );
    record.complete = ["start"];
    record.predictions = { start: { option: 0 } };
    const put = async (value) =>
      call("/api/records/topics/sample", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "If-Match": (await call("/api/records/topics/sample")).headers.get(
            "etag",
          ),
        },
        body: JSON.stringify(value),
      });
    assert.equal((await put(record)).status, 200);
    // A proxy that compresses the response marks the validator weak.
    const weak = `W/${(await call("/api/records/topics/sample")).headers.get("etag")}`;
    assert.equal(
      (
        await call("/api/records/topics/sample", {
          method: "PUT",
          headers: { "Content-Type": "application/json", "If-Match": weak },
          body: JSON.stringify(record),
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await call("/api/records/topics/sample", {
          method: "PUT",
          headers: { "If-Match": initialTag },
          body: JSON.stringify(record),
        })
      ).status,
      412,
    );
    assert.equal(
      (
        await call("/api/records/topics/sample", {
          method: "PUT",
          body: JSON.stringify(record),
        })
      ).status,
      428,
    );
    assert.deepEqual(
      await (await call("/api/records/topics/sample")).json(),
      record,
    );
    assert.equal((await put({ ...record, complete: ["missing"] })).status, 400);
    assert.equal(
      (await put({ ...record, predictions: { start: { option: 99 } } })).status,
      400,
    );
    const notes = { "/notes/reader-test/first": { opened: 123, read: true } };
    assert.equal(
      (
        await call("/api/records/notes", {
          method: "PUT",
          headers: {
            "If-Match": (await call("/api/records/notes")).headers.get("etag"),
          },
          body: JSON.stringify(notes),
        })
      ).status,
      200,
    );
    assert.deepEqual(await (await call("/api/records/notes")).json(), notes);
    assert.equal(
      (
        await call("/api/records/notes", {
          method: "PUT",
          headers: {
            "If-Match": (await call("/api/records/notes")).headers.get("etag"),
          },
          body: JSON.stringify({
            "/notes/reader-test/author/plan": { opened: 1, read: true },
          }),
        })
      ).status,
      400,
    );
    records.close();
    assert.equal((await call("/healthz")).status, 503);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    if (records.isOpen) records.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("the site glossary lists the notes and topic chapters that use each term", async () => {
  const root = await mkdtemp(join(tmpdir(), "il-glossary-test-"));
  const records = openRecords(join(root, "records.sqlite"));
  const content = await fixtureContent(root, [
    "sites/instruments",
    "notes/reader-test",
  ]);
  const server = createWebServer({
    records,
    snapshot: join(root, "releases/current"),
  });
  const readJson = async (path) =>
    JSON.parse(await readFile(join(content, path), "utf8"));
  const writeJson = (path, value) =>
    writeFile(join(content, path), JSON.stringify(value));
  try {
    const instruments = await readJson("sites/instruments/content.json");
    instruments.chapters[0].terms = ["样品"];
    await writeJson("sites/instruments/content.json", instruments);
    const glossary = await readJson("glossary.json");
    // Without the topic that first used the term, it belongs to the note and the other topic.
    const notePath = join(content, "notes/reader-test/first.md");
    await writeFile(
      notePath,
      (await readFile(notePath, "utf8")).replace(
        "[去做预测](/practice/sample/start)",
        "",
      ),
    );
    await serve(content, join(root, "releases"));
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}`;
    const call = async (path) => (await fetch(base + path)).json();
    const note = await call("/api/notes/reader-test/first");
    assert.match(note.html, /data-term="样品"/);
    assert.deepEqual(note.terms, {
      样品: glossary[0],
    });
    assert.deepEqual(
      (await call("/api/topics/instruments")).glossary,
      glossary,
    );
    assert.deepEqual((await call("/api/index")).terms, glossary);
    assert.deepEqual(await call("/api/glossary"), [
      {
        ...glossary[0],
        uses: [
          {
            title: "第一篇观察",
            context: note.directoryTitle,
            path: "/notes/reader-test/first",
          },
          {
            title: "观察工具",
            context: "观察工具",
            path: "/sites/instruments/instruments",
          },
        ],
      },
    ]);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    records.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("citations serve cited pages, articles and epub chapters", async () => {
  const root = await mkdtemp(join(tmpdir(), "il-citation-test-"));
  const records = openRecords(join(root, "records.sqlite"));
  const content = await fixtureContent(root, [
    "notes/cited-reading",
    "sites/cited-sources",
  ]);
  const server = createWebServer({
    records,
    snapshot: join(root, "releases/current"),
  });
  try {
    const snapshot = await serve(content, join(root, "releases"), {
      shelf: shelf(root),
    });
    const note = snapshot.notes[0].compiled;
    const boxed = "src:handbook#2-3&print=12&rect=72,300,540,420";
    assert.match(
      note.html,
      /<button type="button" class="cite" data-cite="src:handbook#2-3&amp;print=12&amp;rect=72,300,540,420">PDF 第 2–3 页<\/button>/,
    );
    assert.deepEqual(Object.keys(note.citations).sort(), [
      boxed,
      "src:handbook#4",
      "src:lesson-1",
      "src:manual#1&print=iv",
      "src:reader#ch=3.1",
      "src:reader#ch=3.1&sec=2",
    ]);
    const pages = note.citations[boxed];
    assert.deepEqual(
      { ...pages, pages: undefined },
      {
        type: "pdf",
        title: "样本手册",
        kind: "教材",
        author: "测试作者",
        edition: "第 2 版",
        first: 2,
        last: 3,
        print: "12",
        rect: [72, 300, 540, 420],
        pages: undefined,
      },
    );
    assert.deepEqual(
      pages.pages.map(({ page, label, size }) => [page, label, size]),
      [
        [1, "11", [612, 792]],
        [2, "12", [612, 792]],
        [3, "13", [612, 792]],
        [4, "14", [612, 792]],
      ],
    );
    assert.deepEqual(
      note.citations["src:manual#1&print=iv"].pages.map((p) => p.label),
      ["iv", undefined],
    );
    const directory = snapshot.directories[0].compiled;
    assert.deepEqual(Object.keys(directory.citations), ["src:handbook#1"]);

    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}`;
    const image = await fetch(base + pages.pages[1].image);
    assert.equal(image.status, 200);
    assert.equal(image.headers.get("content-type"), "image/webp");
    const lesson = note.citations["src:lesson-1"];
    assert.deepEqual(
      [lesson.type, lesson.url, lesson.downloaded],
      ["web", "https://example.org/lesson-1", "2026-10-01"],
    );
    const { html } = await (await fetch(base + lesson.body)).json();
    const [figure] = /\/notes\/cited-reading\/cited\/[a-f0-9]{64}\.png/.exec(
      html,
    );
    assert.deepEqual(
      Buffer.from(await (await fetch(base + figure)).arrayBuffer()),
      await readFile(
        resolve("tests/fixtures/shelf/reports/sample-report/figure-1.png"),
      ),
    );
    // Both citations of the chapter share one body; the section one names where to open.
    const chapter = note.citations["src:reader#ch=3.1"];
    const section = note.citations["src:reader#ch=3.1&sec=2"];
    assert.deepEqual(section, {
      ...chapter,
      section: { key: "2", title: "2.2 细节" },
    });
    assert.deepEqual(
      { ...chapter, body: undefined },
      {
        type: "epub",
        title: "样本读本",
        kind: "教材",
        author: "测试作者",
        chapter: "第 2 章 通路",
        body: undefined,
      },
    );
    const book = (await (await fetch(base + chapter.body)).json()).html;
    assert.match(book, /<h3 data-section="2">2\.2 细节<\/h3>/);
    const images = [
      ...book.matchAll(
        /src="(\/notes\/cited-reading\/cited\/[a-f0-9]{64}\.png)"/g,
      ),
    ].map(([, path]) => path);
    assert.equal(images.length, 3);
    for (const path of images) {
      const response = await fetch(base + path);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "image/png");
    }
    const topic = await (
      await fetch(base + "/api/topics/cited-sources")
    ).json();
    assert.deepEqual(Object.keys(topic.citations).sort(), [
      "src:handbook#2&rect=72,300,540,420",
      "src:handbook#2-3&print=12",
      "src:handbook#3-4",
      "src:lesson-1",
    ]);
    assert.match(
      topic.citations["src:lesson-1"].body,
      /^\/sites\/cited-sources\/cited\//,
    );
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    records.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("record CAS distinguishes absence, concurrent creation, reset and deletion", async () => {
  const root = await mkdtemp(join(tmpdir(), "il-records-test-"));
  const records = openRecords(join(root, "records.sqlite"));
  const server = createWebServer({ records });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}/api/records/notes`;
  const get = () => fetch(url);
  const put = (document, tag) =>
    fetch(url, {
      method: "PUT",
      headers: tag ? { "If-Match": tag } : {},
      body: JSON.stringify(document),
    });
  try {
    const empty = await get();
    const absent = empty.headers.get("etag");
    assert.equal(absent, '"absent"');
    const a = { "/notes/test/first": { opened: 1, read: false } },
      b = { "/notes/test/second": { opened: 2, read: true } };
    const results = await Promise.all([put(a, absent), put(b, absent)]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 412]);
    assert.equal((await put(a)).status, 428);
    let latest = await get();
    let tag = latest.headers.get("etag");
    assert.equal((await put({}, tag)).status, 200);
    latest = await get();
    tag = latest.headers.get("etag");
    assert.notEqual(tag, absent);
    assert.deepEqual(await latest.json(), {});
    assert.equal((await put(b, absent)).status, 412);
    assert.equal((await put({ ...a, ...b }, tag)).status, 200);
    latest = await get();
    tag = latest.headers.get("etag");
    assert.equal((await put(b, tag)).status, 200);
    assert.deepEqual(await (await get()).json(), b);
    assert.equal((await put(a, tag)).status, 412);
    // The file keeps records and their revisions across a restart.
    tag = (await get()).headers.get("etag");
    records.close();
    const reopened = openRecords(join(root, "records.sqlite"));
    assert.deepEqual(readRecord(reopened, { scope: "notes" }), {
      document: b,
      revision: tag.slice(1, -1),
    });
    assert.deepEqual(allRecords(reopened), { topics: {}, notes: b });
    reopened.close();
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    if (records.isOpen) records.close();
    await rm(root, { recursive: true, force: true });
  }
});
