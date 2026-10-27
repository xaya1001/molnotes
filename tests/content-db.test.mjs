import {
  committedSource,
  pullUnit,
  pullRegistry,
  pullGlossary,
} from "../server/content-files.mjs";
import test from "node:test";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  writeFile,
  cp,
  rm,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { once } from "node:events";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { testDatabase } from "./helpers/database.mjs";
import { assetStore } from "../server/assets.mjs";
import { pushUnits, removeUnit } from "../server/content-publish.mjs";
import { migrate } from "../server/database.mjs";
import { createWebServer } from "../server/web.mjs";
import { publishSnapshot } from "./helpers/content-snapshot.mjs";

const execFileAsync = promisify(execFile);

/** Points `releases/current` at a snapshot of the content the database holds. */
const serveDatabase = (pool, store, releases) =>
  publishSnapshot(releases, async (directory) => {
    const rows = async (sql) => (await pool.query(sql)).rows;
    const assets = await rows(
      "SELECT scope, path, sha256, size::int, content_type FROM assets",
    );
    for (const asset of assets) {
      const file = join(directory, "files", asset.scope, asset.path);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, await store.fetchObject(asset.sha256));
    }
    await writeFile(
      join(directory, "snapshot.json"),
      JSON.stringify({
        format: 1,
        topics: await rows("SELECT slug, site, content, citations FROM topics"),
        directories: await rows(
          "SELECT dir, metadata, citations, compiled FROM note_directories",
        ),
        notes: await rows(
          "SELECT dir, slug, author, source, compiled FROM notes",
        ),
        glossary: (await rows("SELECT terms FROM glossary"))[0]?.terms ?? [],
        registry:
          (await rows("SELECT registry FROM source_registry"))[0]?.registry ??
          null,
        assets,
      }),
    );
  });

// Explicit opt-in keeps ordinary contract unit tests independent of a server.
test(
  "content publication, export, references, records and HTTP assets",
  { skip: process.env.MOLNOTES_DATABASE_TESTS !== "1" },
  async () => {
    const db = await testDatabase();
    const root = await mkdtemp(join(tmpdir(), "il-content-test-"));
    const store = await assetStore("dir:" + join(root, "objects"));
    const content = join(root, "content");
    await cp(resolve("tests/fixtures/content"), content, { recursive: true });
    const server = createWebServer({
      pool: db.pool,
      snapshot: join(root, "releases/current"),
    });
    try {
      await migrate(db.pool);
      assert.equal(
        (await db.pool.query("SELECT count(*)::int AS n FROM migrations"))
          .rows[0].n,
        8,
      );
      await pushUnits(db.pool, store, content, ["sites/sample"]);
      await pushUnits(db.pool, store, content, ["sites/instruments"]);
      // The publisher is shown the notebook's author material, in its own order.
      assert.deepEqual(
        await pushUnits(db.pool, store, content, ["notes/reader-test"]),
        [
          {
            unit: "notes/reader-test",
            assets: 1,
            author: [
              {
                file: "notes/reader-test/author/conventions.md",
                title: "写作约定",
              },
              { file: "notes/reader-test/author/plan.md", title: "写作规划" },
            ],
          },
        ],
      );
      // Unchanged assets are not downloaded again by a pull, nor checked
      // against the store again by a push.
      const calls = { fetchObject: 0, hasObject: 0 };
      const counted = {
        ...store,
        fetchObject: (key) => (calls.fetchObject++, store.fetchObject(key)),
        hasObject: (key) => (calls.hasObject++, store.hasObject(key)),
      };
      const pullCache = join(root, "pull-cache");
      const exportedAsset = join(
        root,
        "export/notes/reader-test/assets/sample.svg",
      );
      await pullUnit(
        db.pool,
        counted,
        join(root, "export"),
        "notes/reader-test",
        pullCache,
      );
      assert.equal(calls.fetchObject, 1);
      await writeFile(exportedAsset, "<svg/>");
      await pullUnit(
        db.pool,
        counted,
        join(root, "export"),
        "notes/reader-test",
        pullCache,
      );
      await pullUnit(
        db.pool,
        counted,
        join(root, "export"),
        "notes/reader-test",
        pullCache,
      );
      assert.equal(calls.fetchObject, 1);
      assert.equal(
        await readFile(exportedAsset, "utf8"),
        await readFile(
          join(content, "notes/reader-test/assets/sample.svg"),
          "utf8",
        ),
      );
      for (const file of ["first.md", "author/plan.md"])
        assert.equal(
          await readFile(join(root, "export/notes/reader-test", file), "utf8"),
          await readFile(join(content, "notes/reader-test", file), "utf8"),
        );
      await pushUnits(db.pool, counted, content, ["notes/reader-test"]);
      assert.equal(calls.hasObject, 0);
      // Public and author notes can share a slug; compilation must target both keys.
      const authorFirst = join(content, "notes/reader-test/author/first.md");
      const publicFirst = await readFile(
        join(content, "notes/reader-test/first.md"),
        "utf8",
      );
      await writeFile(
        authorFirst,
        publicFirst.replace("第一篇观察", "作者观察"),
      );
      await pushUnits(db.pool, store, content, ["notes/reader-test"]);
      const compiledNotes = async () =>
        (
          await db.pool.query(
            "SELECT author, compiled FROM notes WHERE dir='reader-test' AND slug='first' ORDER BY author",
          )
        ).rows;
      const both = await compiledNotes();
      assert.equal(both.length, 2);
      assert.equal(both[0].compiled.title, "第一篇观察");
      assert.equal(both[1].compiled.title, "作者观察");
      assert.ok(both.every((row) => !Object.hasOwn(row.compiled, "author")));
      await pushUnits(db.pool, store, content, ["sites/sample"]);
      assert.deepEqual(await compiledNotes(), both);
      await rm(authorFirst);
      await pushUnits(db.pool, store, content, ["notes/reader-test"]);

      const prompt = "notes/reader-test/prompts/sample.svg.md";
      assert.equal(
        await readFile(join(root, "export", prompt), "utf8"),
        await readFile(join(content, prompt), "utf8"),
      );
      await writeFile(
        join(content, "notes/reader-test/prompts/missing.svg.md"),
        "画一张缺失的图。",
      );
      await assert.rejects(
        pushUnits(db.pool, store, content, ["notes/reader-test"]),
        /no matching asset/,
      );
      await rm(join(content, "notes/reader-test/prompts/missing.svg.md"));
      const planPath = join(content, "notes/reader-test/author/plan.md");
      const plan = await readFile(planPath, "utf8");
      await writeFile(planPath, plan.replace("[[样品]]", "[[不存在]]"));
      await assert.rejects(
        pushUnits(db.pool, store, content, ["notes/reader-test"]),
        /notes\/reader-test\/author\/plan\.md:\d+: Unknown term/,
      );
      await writeFile(planPath, plan);
      await assert.rejects(
        removeUnit(db.pool, "sites/sample"),
        /Unknown internal link \/practice\/sample\//,
      );
      const original = await readFile(
        join(content, "notes/reader-test/first.md"),
        "utf8",
      );
      for (const [from, to, pattern] of [
        ["[[样品]]", "[[不存在]]", /Unknown term/],
        ["assets/sample.svg", "assets/missing.svg", /Missing image/],
        ["CCO", "invalid smiles", /Invalid SMILES/],
        ["/practice/sample/start", "/sites/missing/", /Unknown internal link/],
      ]) {
        await writeFile(
          join(content, "notes/reader-test/first.md"),
          original.replace(from, to),
        );
        await assert.rejects(
          pushUnits(db.pool, store, content, ["notes/reader-test"]),
          pattern,
        );
        assert.equal(
          (
            await db.pool.query(
              "SELECT source FROM notes WHERE slug='first' AND NOT author",
            )
          ).rows[0].source,
          original,
        );
      }
      await serveDatabase(db.pool, store, join(root, "releases"));
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const base = `http://127.0.0.1:${server.address().port}`;
      const call = (path, options) => fetch(base + path, options);
      assert.equal((await call("/healthz")).status, 200);
      const reviewMetadata = await (await call("/api/review")).json();
      const searchIndex = await (await call("/api/index")).json();
      assert.deepEqual(reviewMetadata.chapters, searchIndex.chapters);
      assert.deepEqual(reviewMetadata.quiz, searchIndex.quiz);
      assert.deepEqual(Object.keys(reviewMetadata).sort(), [
        "chapters",
        "quiz",
      ]);

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
      const manifest = join(content, "sites/instruments/site.json");
      const site = JSON.parse(await readFile(manifest, "utf8"));
      for (const group of [undefined, "其他"]) {
        await writeFile(manifest, JSON.stringify({ ...site, group }));
        await assert.rejects(
          pushUnits(db.pool, store, content, ["sites/instruments"]),
          /group must be one of/,
        );
      }
      await writeFile(manifest, JSON.stringify(site));
      assert.equal(
        (
          await db.pool.query(
            "SELECT site->>'group' AS g FROM topics WHERE slug='instruments'",
          )
        ).rows[0].g,
        "谱图",
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
      await pushUnits(db.pool, store, content, ["notes/reader-test"]);
      await serveDatabase(db.pool, store, join(root, "releases"));
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
      const planHtml = (
        await db.pool.query(
          "SELECT compiled FROM notes WHERE dir=$1 AND slug=$2 AND author",
          ["reader-test", "plan"],
        )
      ).rows[0].compiled.html;
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
      assert.equal(
        (await put({ ...record, complete: ["missing"] })).status,
        400,
      );
      assert.equal(
        (await put({ ...record, predictions: { start: { option: 99 } } }))
          .status,
        400,
      );
      const notes = { "/notes/reader-test/first": { opened: 123, read: true } };
      assert.equal(
        (
          await call("/api/records/notes", {
            method: "PUT",
            headers: {
              "If-Match": (await call("/api/records/notes")).headers.get(
                "etag",
              ),
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
              "If-Match": (await call("/api/records/notes")).headers.get(
                "etag",
              ),
            },
            body: JSON.stringify({
              "/notes/reader-test/author/plan": { opened: 1, read: true },
            }),
          })
        ).status,
        400,
      );
      const query = db.pool.query;
      db.pool.query = async () => {
        throw new Error("unavailable");
      };
      assert.equal((await call("/healthz")).status, 503);
      db.pool.query = query;
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await db.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  "the site glossary is checked on every publication and outlives the topics that use it",
  { skip: process.env.MOLNOTES_DATABASE_TESTS !== "1" },
  async () => {
    const db = await testDatabase();
    const root = await mkdtemp(join(tmpdir(), "il-glossary-test-"));
    const store = await assetStore("dir:" + join(root, "objects"));
    const content = join(root, "content");
    await cp(resolve("tests/fixtures/content"), content, { recursive: true });
    const server = createWebServer({
      pool: db.pool,
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
      await pushUnits(db.pool, store, content, [
        "sites/sample",
        "sites/instruments",
        "notes/reader-test",
      ]);
      const published = async () =>
        JSON.stringify([
          (await db.pool.query("SELECT terms FROM glossary")).rows,
          (
            await db.pool.query(
              "SELECT slug, content FROM topics ORDER BY slug",
            )
          ).rows,
        ]);
      const before = await published();
      const glossary = await readJson("glossary.json");
      const sample = await readJson("sites/sample/content.json");
      for (const [path, value, pattern] of [
        ["glossary.json", [...glossary, ...glossary], /duplicate term 样品/],
        [
          "glossary.json",
          [{ ...glossary[0], confusion: "" }],
          /confusion must be text/,
        ],
        // A term still in use cannot leave the glossary.
        ["glossary.json", [], /Unknown term 样品|unknown term 样品/],
        [
          "sites/sample/content.json",
          {
            ...sample,
            chapters: [
              { ...sample.chapters[0], terms: ["不存在"] },
              sample.chapters[1],
            ],
          },
          /chapter start uses unknown term 不存在/,
        ],
        [
          "sites/sample/content.json",
          { ...sample, glossary: [] },
          /define terms in glossary\.json/,
        ],
      ]) {
        const original = await readFile(join(content, path), "utf8");
        await writeJson(path, value);
        await assert.rejects(
          pushUnits(db.pool, store, content, ["sites/sample"]),
          pattern,
        );
        await writeFile(join(content, path), original);
        assert.equal(await published(), before);
      }
      await rm(join(content, "glossary.json"));
      await assert.rejects(
        pushUnits(db.pool, store, content, ["sites/sample"]),
        /glossary\.json: missing/,
      );
      assert.equal(await published(), before);

      const exported = join(root, "export");
      assert.equal(await pullGlossary(db.pool, exported), true);
      assert.deepEqual(
        JSON.parse(await readFile(join(exported, "glossary.json"), "utf8")),
        glossary,
      );

      // Removing the topic that first used the term leaves it to the note and the other topic.
      const notePath = join(content, "notes/reader-test/first.md");
      await writeFile(
        notePath,
        (await readFile(notePath, "utf8")).replace(
          "[去做预测](/practice/sample/start)",
          "",
        ),
      );
      await writeJson("glossary.json", glossary);
      await pushUnits(db.pool, store, content, ["notes/reader-test"]);
      await removeUnit(db.pool, "sites/sample");

      await serveDatabase(db.pool, store, join(root, "releases"));
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
      await db.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  "a group publication resolves cycles and rolls back all units on rejection",
  { skip: process.env.MOLNOTES_DATABASE_TESTS !== "1" },
  async () => {
    const db = await testDatabase();
    const root = await mkdtemp(join(tmpdir(), "il-group-test-"));
    try {
      const content = join(root, "content");
      await cp(resolve("tests/fixtures/content"), content, { recursive: true });
      const store = await assetStore("dir:" + join(root, "objects"));
      const path = join(content, "sites/sample/content.json");
      const sample = JSON.parse(await readFile(path, "utf8"));
      sample.chapters[0].blocks.push({
        type: "callout",
        text: "继续观察",
        link: { to: "../instruments/", text: "工具" },
      });
      await writeFile(path, JSON.stringify(sample));
      const otherPath = join(content, "sites/instruments/content.json");
      const other = JSON.parse(await readFile(otherPath, "utf8"));
      other.chapters[0].blocks.push({
        type: "callout",
        text: "返回",
        link: { to: "/practice/sample/start#source-1", text: "样品" },
      });
      await writeFile(otherPath, JSON.stringify(other));
      await assert.rejects(
        pushUnits(db.pool, store, content, ["sites/sample"]),
        /unknown internal link/,
      );
      await pushUnits(db.pool, store, content, [
        "sites/sample",
        "sites/instruments",
        "notes/reader-test",
      ]);
      assert.equal(
        (await db.pool.query("SELECT count(*)::int AS n FROM topics")).rows[0]
          .n,
        2,
      );
      sample.chapters[0].title = "changed";
      await writeFile(path, JSON.stringify(sample));
      other.chapters[0].blocks.push({
        type: "figure",
        src: "/sites/instruments/static/missing.png",
        alt: "missing",
        caption: "missing",
      });
      await writeFile(otherPath, JSON.stringify(other));
      await assert.rejects(
        pushUnits(db.pool, store, content, [
          "sites/sample",
          "sites/instruments",
        ]),
        /unknown resource/,
      );
      assert.equal(
        (await db.pool.query("SELECT content FROM topics WHERE slug='sample'"))
          .rows[0].content.chapters[0].title,
        "样品预测",
      );
    } finally {
      await db.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  "only committed content publishes, and never over a publication the commit lacks",
  { skip: process.env.MOLNOTES_DATABASE_TESTS !== "1" },
  async () => {
    const db = await testDatabase();
    const root = await mkdtemp(join(tmpdir(), "il-git-test-"));
    const store = await assetStore("dir:" + join(root, "objects"));
    const main = join(root, "main");
    const run = (dir, ...args) =>
      execFileAsync("git", ["-C", dir, ...args]).then((r) => r.stdout.trim());
    const commit = async (dir, message) => {
      await run(dir, "add", "-A");
      await run(dir, "commit", "-qm", message);
      return run(dir, "rev-parse", "HEAD");
    };
    const append = async (dir, file, text) => {
      const path = join(dir, file);
      await writeFile(path, (await readFile(path, "utf8")) + `\n${text}\n`);
    };
    const units = ["notes/reader-test", "sites/instruments", "sites/sample"];
    const paths = (list) => [...list, "sources.json", "glossary.json"];
    const push = async (dir, list, pusher = "agent") =>
      pushUnits(db.pool, store, dir, list, {
        source: await committedSource(dir, paths(list), pusher),
      });
    const remove = async (dir, unit) =>
      removeUnit(db.pool, unit, {
        source: await committedSource(dir, [unit], "agent"),
      });
    const recorded = async (unit) =>
      (
        await db.pool.query(
          "SELECT git_commit FROM content_units WHERE unit = $1",
          [unit],
        )
      ).rows[0]?.git_commit;
    const firstNote = async () =>
      (
        await db.pool.query(
          "SELECT source FROM notes WHERE dir = 'reader-test' AND slug = 'first' AND NOT author",
        )
      ).rows[0].source;
    try {
      // The commit migration is safe to apply again.
      await db.pool.query(
        await readFile("server/schema/009-content-commits.sql", "utf8"),
      );
      await cp(resolve("tests/fixtures/content"), main, { recursive: true });
      await assert.rejects(
        committedSource(main, paths(units), "agent"),
        /not inside a Git work tree/,
      );
      await run(root, "init", "-q", "-b", "main", main);
      await run(main, "config", "user.name", "Test");
      await run(main, "config", "user.email", "test@example.invalid");
      const initial = await commit(main, "initial");
      // Published before commits were recorded.
      await pushUnits(db.pool, store, main, ["sites/sample"]);

      // Uncommitted and untracked files are listed and nothing is published.
      await append(main, "notes/reader-test/first.md", "未提交");
      await writeFile(join(main, "notes/reader-test/draft.md"), "草稿\n");
      await assert.rejects(
        push(main, ["notes/reader-test"]),
        (error) =>
          /M notes\/reader-test\/first\.md/.test(error.message) &&
          /\?\? notes\/reader-test\/draft\.md/.test(error.message),
      );
      await run(main, "checkout", "--", ".");
      await rm(join(main, "notes/reader-test/draft.md"));

      // A new unit publishes and records its commit; an unrecorded one that
      // matches the commit is recorded too.
      await push(main, ["notes/reader-test", "sites/sample"]);
      for (const unit of ["notes/reader-test", "sites/sample"])
        assert.equal(await recorded(unit), initial);

      // An unrecorded unit that differs from the commit is rejected until
      // it is pulled and committed.
      await db.pool.query(
        "UPDATE content_units SET git_commit = NULL WHERE unit = 'sites/sample'",
      );
      const sample = join(main, "sites/sample/content.json");
      const changed = JSON.parse(await readFile(sample, "utf8"));
      changed.chapters[0].title = "本地改动";
      await writeFile(sample, JSON.stringify(changed));
      await commit(main, "retitle sample");
      await assert.rejects(
        push(main, ["sites/sample"]),
        /Published before commits were recorded[^]*sites\/sample[^]*Nothing was written/,
      );
      assert.equal(
        (await db.pool.query("SELECT content FROM topics WHERE slug='sample'"))
          .rows[0].content.chapters[0].title,
        "样品预测",
      );
      await pullUnit(db.pool, store, main, "sites/sample", join(root, "cache"));
      await commit(main, "take the published sample");
      await push(main, ["sites/sample"]);

      // A task branch that lacks a publication from main is rejected until
      // it merges main.
      const task = join(root, "task");
      await run(main, "worktree", "add", "-q", "-b", "content/task", task);
      await append(main, "notes/reader-test/first.md", "主仓库修改");
      const fromMain = await commit(main, "edit first");
      await push(main, ["notes/reader-test"], "planner");
      await append(task, "notes/reader-test/second.md", "任务修改");
      await commit(task, "edit second");
      await assert.rejects(
        push(task, ["notes/reader-test"]),
        new RegExp(
          `does not contain[^]*notes/reader-test  ${fromMain.slice(0, 7)} .* planner`,
        ),
      );
      assert.match(await firstNote(), /主仓库修改/);
      await run(task, "merge", "-q", "--no-edit", "main");
      await push(task, ["notes/reader-test"]);
      assert.equal(
        await recorded("notes/reader-test"),
        await run(task, "rev-parse", "HEAD"),
      );

      // A recorded commit this repository does not have is not contained.
      const merged = await recorded("notes/reader-test");
      await db.pool.query(
        "UPDATE content_units SET git_commit = $1 WHERE unit = 'notes/reader-test'",
        ["f".repeat(40)],
      );
      await assert.rejects(
        push(task, ["notes/reader-test"]),
        /does not contain/,
      );
      await db.pool.query(
        "UPDATE content_units SET git_commit = $1 WHERE unit = 'notes/reader-test'",
        [merged],
      );

      // Two branches from the same commit race; only one publishes.
      await run(main, "merge", "-q", "content/task");
      const racers = ["x", "y"].map((name) => join(root, name));
      for (const [i, dir] of racers.entries()) {
        await run(main, "worktree", "add", "-q", "-b", `content/${i}`, dir);
        await append(dir, "notes/reader-test/first.md", `并发 ${i}`);
        await commit(dir, `race ${i}`);
      }
      const race = await Promise.allSettled(
        racers.map((dir) => push(dir, ["notes/reader-test"])),
      );
      assert.deepEqual(race.map((r) => r.status).sort(), [
        "fulfilled",
        "rejected",
      ]);
      assert.match(
        race.find((r) => r.status === "rejected").reason.message,
        /does not contain/,
      );

      // Removal needs the deletion committed and every publication merged.
      await run(
        main,
        "merge",
        "-q",
        "--no-ff",
        "--no-edit",
        await recorded("notes/reader-test"),
      );
      await push(main, ["sites/instruments"]);
      await assert.rejects(
        remove(main, "sites/instruments"),
        /delete it in the content repository and commit first/,
      );
      await run(racers[0], "rm", "-rq", "sites/instruments");
      await commit(racers[0], "remove instruments");
      await assert.rejects(
        remove(racers[0], "sites/instruments"),
        /does not contain/,
      );
      await run(main, "rm", "-rq", "sites/instruments");
      const removal = await commit(main, "remove instruments");
      await remove(main, "sites/instruments");
      assert.equal(await recorded("sites/instruments"), removal);
      // A branch without the removal cannot bring the unit back.
      await assert.rejects(
        push(task, ["sites/instruments"]),
        /does not contain/,
      );

      // The content command lists publications and refuses a plain directory.
      const env = {
        ...process.env,
        MOLNOTES_DATABASE_URL: db.url,
        MOLNOTES_ASSET_STORE: "dir:" + join(root, "objects"),
        MOLNOTES_ASSET_CACHE: join(root, "cache"),
        MOLNOTES_CONTENT_DIR: main,
        MOLNOTES_PUSHER: "session w1",
      };
      const content = (...args) =>
        execFileAsync(process.execPath, ["scripts/content.mjs", ...args], {
          env,
        });
      await append(main, "notes/reader-test/second.md", "命令行");
      const head = await commit(main, "edit second again");
      assert.match(
        (await content("push", "notes/reader-test")).stdout,
        new RegExp(`published from ${head.slice(0, 7)}`),
      );
      assert.match(
        (await content("list")).stdout,
        new RegExp(
          `^notes/reader-test  ${head.slice(0, 7)}  \\S+ \\S+ UTC  .* session w1`,
          "m",
        ),
      );
      await assert.rejects(
        execFileAsync(process.execPath, ["scripts/content.mjs", "list"], {
          env: { ...env, MOLNOTES_CONTENT_DIR: join(root, "objects") },
        }),
        /not inside a Git work tree/,
      );
    } finally {
      await db.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  "citations publish cited pages, articles and epub chapters, and any failed check leaves the database unchanged",
  { skip: process.env.MOLNOTES_DATABASE_TESTS !== "1" },
  async () => {
    const db = await testDatabase();
    const root = await mkdtemp(join(tmpdir(), "il-citation-test-"));
    const store = await assetStore("dir:" + join(root, "objects"));
    const content = join(root, "content");
    await cp(resolve("tests/fixtures/content"), content, { recursive: true });
    const shelf = {
      materials: resolve("tests/fixtures/shelf"),
      cache: join(root, "cache"),
    };
    const server = createWebServer({
      pool: db.pool,
      snapshot: join(root, "releases/current"),
    });
    const units = ["notes/cited-reading", "sites/cited-sources"];
    try {
      await pushUnits(db.pool, store, content, units, { shelf });
      const registryFile = join(content, "sources.json");
      const originalRegistry = await readFile(registryFile, "utf8");
      await writeFile(registryFile, "{}");
      await assert.rejects(
        pushUnits(db.pool, store, content, ["sites/minimal"], { shelf }),
        /not in sources.json/,
      );
      assert.deepEqual(
        (await db.pool.query("SELECT registry FROM source_registry")).rows[0]
          .registry,
        JSON.parse(originalRegistry),
      );
      assert.equal(
        (await db.pool.query("SELECT 1 FROM topics WHERE slug='minimal'"))
          .rowCount,
        0,
      );
      await writeFile(registryFile, originalRegistry);
      const note = (await db.pool.query("SELECT compiled FROM notes")).rows[0]
        .compiled;
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
      const directory = (
        await db.pool.query("SELECT compiled FROM note_directories")
      ).rows[0].compiled;
      assert.deepEqual(Object.keys(directory.citations), ["src:handbook#1"]);

      await serveDatabase(db.pool, store, join(root, "releases"));
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

      // Exports keep the sources but not the pages rebuilt from the shelf.
      const exported = join(root, "export");
      await pullUnit(
        db.pool,
        store,
        exported,
        "notes/cited-reading",
        join(root, "pull-cache"),
      );
      assert.deepEqual(
        (await readdir(join(exported, "notes/cited-reading"))).sort(),
        ["directory.json", "sources.md"],
      );
      assert.equal(await pullRegistry(db.pool, exported), true);
      assert.deepEqual(
        JSON.parse(await readFile(join(exported, "sources.json"), "utf8")),
        JSON.parse(await readFile(join(content, "sources.json"), "utf8")),
      );

      const notePath = join(content, "notes/cited-reading/sources.md");
      const original = await readFile(notePath, "utf8");
      const registry = await readFile(join(content, "sources.json"), "utf8");
      const published = async () =>
        JSON.stringify([
          (await db.pool.query("SELECT source FROM notes")).rows,
          (await db.pool.query("SELECT citations FROM note_directories")).rows,
          (await db.pool.query("SELECT path FROM assets ORDER BY scope, path"))
            .rows,
          (await db.pool.query("SELECT registry FROM source_registry")).rows,
        ]);
      const before = await published();
      for (const [change, pattern] of [
        [
          ["src:manual#1&print=iv", "src:unknown#1"],
          /sources\.md:\d+: .*not in sources\.json/,
        ],
        [["src:handbook#4", "src:handbook"], /a PDF citation needs pages/],
        [["src:handbook#4", "src:handbook#4-5"], /pages 4-5 outside 1-4/],
        [
          ["src:lesson-1", "src:lesson-1#2"],
          /archived web page is cited without pages/,
        ],
        [
          ["src:reader#ch=3.1)", "src:reader)"],
          /an EPUB citation needs a chapter/,
        ],
        [
          ["src:reader#ch=3.1)", "src:reader#2)"],
          /an EPUB citation needs a chapter/,
        ],
        [
          ["src:reader#ch=3.1)", "src:reader#ch=9)"],
          /no chapter 9 in the navigation/,
        ],
        [
          ["src:reader#ch=3.1)", "src:reader#ch=3.2)"],
          /diagram\.svg is not PNG/,
        ],
        [["sec=2)", "sec=7)"], /section 7 is not in chapter 3\.1/],
        [
          ["rect=72,300,540,420", "rect=72,300,540,900"],
          /rectangle lies outside page 2/,
        ],
        [
          ["src:handbook#4", "/materials/textbooks/sample-handbook.pdf"],
          /Unknown internal link/,
        ],
      ]) {
        await writeFile(notePath, original.replaceAll(...change));
        await assert.rejects(
          pushUnits(db.pool, store, content, units, { shelf }),
          pattern,
        );
        assert.equal(await published(), before);
      }
      await writeFile(notePath, original);
      await writeFile(
        join(content, "sources.json"),
        registry.replace("sample-handbook.pdf", "missing-handbook.pdf"),
      );
      await assert.rejects(
        pushUnits(db.pool, store, content, units, { shelf }),
        /missing-handbook\.pdf: not on the shelf/,
      );
      await rm(join(content, "sources.json"));
      await assert.rejects(
        pushUnits(db.pool, store, content, units, { shelf }),
        /sources\.json: missing/,
      );
      await writeFile(join(content, "sources.json"), registry);
      const topicPath = join(content, "sites/cited-sources/content.json");
      const site = JSON.parse(await readFile(topicPath, "utf8"));
      site.sources[0].file = "textbooks/sample-handbook.pdf";
      await writeFile(topicPath, JSON.stringify(site));
      await assert.rejects(
        pushUnits(db.pool, store, content, units, { shelf }),
        /source 1 names a shelf file/,
      );
      assert.equal(await published(), before);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await db.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  "record CAS distinguishes absence, concurrent creation, reset and deletion",
  { skip: process.env.MOLNOTES_DATABASE_TESTS !== "1" },
  async () => {
    const db = await testDatabase();
    const server = createWebServer({ pool: db.pool });
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
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await db.close();
    }
  },
);

test(
  "a content directory below the top of a repository publishes its committed units",
  { skip: process.env.MOLNOTES_DATABASE_TESTS !== "1" },
  async () => {
    const db = await testDatabase();
    const root = await mkdtemp(join(tmpdir(), "il-git-subdir-test-"));
    const store = await assetStore("dir:" + join(root, "objects"));
    const repo = join(root, "repo");
    const content = join(repo, "content");
    const run = (...args) =>
      execFileAsync("git", ["-C", repo, ...args]).then((r) => r.stdout.trim());
    const units = ["notes/reader-test", "sites/sample"];
    const paths = [...units, "sources.json", "glossary.json"];
    try {
      await cp(resolve("tests/fixtures/content"), content, { recursive: true });
      await writeFile(join(repo, "README.md"), "outside the content\n");
      await run("init", "-q", "-b", "main");
      await run("config", "user.name", "Test");
      await run("config", "user.email", "test@example.invalid");
      await run("add", "-A");
      await run("commit", "-qm", "initial");
      const head = await run("rev-parse", "HEAD");

      // Changes outside the content directory do not block publishing.
      await writeFile(join(repo, "README.md"), "edited\n");
      await pushUnits(db.pool, store, content, units, {
        source: await committedSource(content, paths, "agent"),
      });
      assert.equal(
        (
          await db.pool.query(
            "SELECT git_commit FROM content_units WHERE unit = $1",
            [units[0]],
          )
        ).rows[0].git_commit,
        head,
      );

      // Uncommitted files inside the content directory are listed from the
      // repository root.
      await writeFile(join(content, "notes/reader-test/draft.md"), "草稿\n");
      await assert.rejects(
        committedSource(content, paths, "agent"),
        /\?\? content\/notes\/reader-test\/draft\.md/,
      );
    } finally {
      await db.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
