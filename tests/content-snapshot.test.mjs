import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cp,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { buildSnapshot } from "../server/content-publish.mjs";
import {
  keptSnapshots,
  publishSnapshot,
  rollbackSnapshot,
  writeSnapshot,
} from "../server/content-snapshot.mjs";

const execFileAsync = promisify(execFile);
const fixtures = resolve("tests/fixtures/content");
const materials = resolve("tests/fixtures/shelf");

async function temporary(t) {
  const root = await mkdtemp(join(tmpdir(), "molnotes-snapshot-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
const content = (root, ...args) =>
  execFileAsync(process.execPath, ["scripts/content.mjs", ...args], {
    env: {
      ...process.env,
      MOLNOTES_CONTENT_DIR: join(root, "repo/content"),
      MOLNOTES_CONTENT_RELEASES: join(root, "releases"),
      MOLNOTES_MATERIALS_DIR: materials,
      MOLNOTES_MATERIALS_CACHE: join(root, "shelf-cache"),
    },
  });

test("a snapshot holds every unit's rows and its asset files", async (t) => {
  const root = await temporary(t);
  const shelf = { materials, cache: join(root, "shelf-cache") };
  const output = join(root, "snapshot");
  await writeSnapshot(output, await buildSnapshot(fixtures, { shelf }));
  const snapshot = JSON.parse(
    await readFile(join(output, "snapshot.json"), "utf8"),
  );
  assert.equal(snapshot.format, 1);
  assert.equal(snapshot.commit, null);
  assert.deepEqual(snapshot.topics.map((topic) => topic.slug).sort(), [
    "cited-sources",
    "fable-patent",
    "instruments",
    "minimal",
    "sample",
  ]);
  assert.deepEqual(
    snapshot.directories.map((directory) => directory.dir).sort(),
    ["cited-reading", "reader-test"],
  );
  for (const directory of snapshot.directories)
    assert.equal(directory.compiled.slug, directory.dir);
  // Author material is in the snapshot, its compiled body without the author flag.
  const author = snapshot.notes.filter((note) => note.author);
  assert.ok(author.length > 0);
  for (const note of snapshot.notes) {
    assert.equal(note.compiled.slug, note.slug);
    assert.equal(note.compiled.directory, note.dir);
    assert.equal("author" in note.compiled, false);
  }
  assert.deepEqual(
    snapshot.glossary,
    JSON.parse(await readFile(join(fixtures, "glossary.json"), "utf8")),
  );
  assert.ok(snapshot.registry);
  assert.ok(snapshot.assets.some((asset) => asset.path.startsWith("cited/")));
  assert.ok(snapshot.assets.some((asset) => asset.prompt !== null));
  for (const asset of snapshot.assets) {
    const bytes = await readFile(
      join(output, "files", asset.scope, asset.path),
    );
    assert.equal(bytes.length, asset.size);
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      asset.sha256,
    );
  }
  await assert.rejects(
    writeSnapshot(output, await buildSnapshot(fixtures, { shelf })),
    /already exists/,
  );
});

test("publish switches current to the committed snapshot, keeps five and rolls back", async (t) => {
  const root = await temporary(t);
  const repo = join(root, "repo");
  const releases = join(root, "releases");
  const git = (...args) =>
    execFileAsync("git", ["-C", repo, ...args]).then((r) => r.stdout.trim());
  await cp(fixtures, join(repo, "content"), { recursive: true });
  await writeFile(join(repo, "README.md"), "outside the content\n");
  await git("init", "-q");
  await git("add", ".");
  await git(
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@example.invalid",
    "commit",
    "-qm",
    "content",
  );
  const commit = () =>
    git(
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@example.invalid",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "next",
    );
  const current = () => readlink(join(releases, "current"));
  const kept = async () =>
    (await readdir(releases)).filter((name) =>
      /^[0-9a-f]{40}-\d{8}T\d{9}Z$/.test(name),
    );
  const commitOf = (name) => name.slice(0, 40);

  const first = await git("rev-parse", "HEAD");
  // Changes outside the content directory do not block publishing.
  await writeFile(join(repo, "README.md"), "edited\n");
  const [, firstName] = /current: (\S+)/.exec(
    (await content(root, "publish")).stdout,
  );
  assert.equal(commitOf(firstName), first);
  assert.equal(await current(), firstName);
  const snapshot = JSON.parse(
    await readFile(join(releases, firstName, "snapshot.json"), "utf8"),
  );
  assert.equal(snapshot.commit, first);

  // Uncommitted, untracked and ignored content is refused and current stays.
  const glossary = join(repo, "content/glossary.json");
  await writeFile(glossary, (await readFile(glossary, "utf8")) + "\n");
  await assert.rejects(
    content(root, "publish"),
    /Only committed content is published[^]*glossary\.json/,
  );
  await git("checkout", "--", ".");
  await writeFile(join(repo, "content/notes/reader-test/draft.md"), "");
  // Paths are listed from the repository root.
  await assert.rejects(
    content(root, "publish"),
    /\?\? content\/notes\/reader-test\/draft\.md/,
  );
  await rm(join(repo, "content/notes/reader-test/draft.md"));
  assert.equal(await current(), firstName);

  // Older snapshots beyond the newest five are removed.
  const shelf = { materials, cache: join(root, "shelf-cache") };
  const publish = () =>
    publishSnapshot(join(repo, "content"), releases, { shelf });
  const published = [firstName];
  for (let i = 0; i < keptSnapshots; i++) {
    await commit();
    published.push(await publish());
  }
  assert.equal(await current(), published.at(-1));
  assert.deepEqual(
    (await kept()).sort(),
    published.slice(-keptSnapshots).sort(),
  );

  // Publishing the same commit again builds a new directory, so the
  // reader sees `current` change; the earlier build stays kept.
  const before = await realpath(join(releases, "current"));
  const again = await publish();
  assert.equal(commitOf(again), commitOf(published.at(-1)));
  assert.notEqual(await realpath(join(releases, "current")), before);
  assert.equal(await current(), again);
  assert.ok((await kept()).includes(published.at(-1)));
  assert.equal((await kept()).length, keptSnapshots);

  const back = published.at(-3);
  await content(root, "publish", "--rollback", commitOf(back).slice(0, 7));
  assert.equal(await current(), back);
  // A commit with several kept builds rolls back to the newest.
  await rollbackSnapshot(releases, commitOf(again));
  assert.equal(await current(), again);
  await assert.rejects(rollbackSnapshot(releases, first), /no kept snapshot/);
  assert.equal(await current(), again);
});

test("a build that fails validation writes nothing", async (t) => {
  const root = await temporary(t);
  await cp(fixtures, join(root, "repo/content"), { recursive: true });
  const note = join(root, "repo/content/notes/reader-test/first.md");
  await writeFile(
    note,
    (await readFile(note, "utf8")) + "\n见 [[没有这个术语]]。\n",
  );
  await assert.rejects(
    content(root, "build", join(root, "out")),
    /first\.md[^]*没有这个术语/,
  );
  assert.deepEqual(
    (await readdir(root)).filter((name) => name.includes("out")),
    [],
  );
  await assert.rejects(content(root, "publish"), /not inside a Git work tree/);
});

/**
 * A copy of the fixtures holding `units` (all when omitted) and a check that
 * building it after `edits` fails with `pattern`. Each edit names a file and
 * returns its new text from the old one, or undefined to delete it; the
 * files are restored afterwards.
 */
async function editableContent(t, units) {
  const root = await temporary(t);
  const directory = join(root, "content");
  await cp(fixtures, directory, {
    recursive: true,
    filter: (source) => {
      const [kind, name] = source.slice(fixtures.length + 1).split("/");
      return !units || !name || !["sites", "notes"].includes(kind)
        ? true
        : units.includes(`${kind}/${name}`);
    },
  });
  const shelf = { materials, cache: join(root, "shelf-cache") };
  const build = () => buildSnapshot(directory, { shelf });
  async function edit(edits) {
    const originals = [];
    for (const [path, change] of edits) {
      const file = join(directory, path);
      const text = await readFile(file, "utf8").catch(() => undefined);
      originals.push([file, text]);
      const next = change(text);
      if (next === undefined) await rm(file, { recursive: true });
      else await writeFile(file, next);
    }
    return async () => {
      for (const [file, text] of originals.reverse())
        if (text === undefined) await rm(file, { force: true });
        else await writeFile(file, text);
    };
  }
  return {
    directory,
    build,
    edit,
    async rejects(edits, pattern) {
      const restore = await edit(edits);
      try {
        await assert.rejects(build(), pattern);
      } finally {
        await restore();
      }
    },
  };
}
const json = (change) => (text) => {
  const value = JSON.parse(text);
  return JSON.stringify(change(value) ?? value);
};

test("a build rejects notes, topics and glossaries that do not resolve", async (t) => {
  const { rejects, edit, build, directory } = await editableContent(t, [
    "sites/sample",
    "sites/instruments",
    "notes/reader-test",
  ]);
  const replace = (from, to) => (text) => text.replace(from, to);
  const first = "notes/reader-test/first.md";
  await rejects(
    [["notes/reader-test/prompts/missing.svg.md", () => "画一张缺失的图。"]],
    /no matching asset/,
  );
  await rejects(
    [["notes/reader-test/author/plan.md", replace("[[样品]]", "[[不存在]]")]],
    /notes\/reader-test\/author\/plan\.md:\d+: Unknown term/,
  );
  for (const [from, to, pattern] of [
    ["[[样品]]", "[[不存在]]", /first\.md:\d+: Unknown term/],
    ["assets/sample.svg", "assets/missing.svg", /Missing image/],
    ["CCO", "invalid smiles", /Invalid SMILES/],
    ["/practice/sample/start", "/sites/missing/", /Unknown internal link/],
  ])
    await rejects([[first, replace(from, to)]], pattern);
  for (const group of [undefined, "其他"])
    await rejects(
      [["sites/instruments/site.json", json((site) => ({ ...site, group }))]],
      /group must be one of/,
    );
  // A topic a note still links to cannot leave the content.
  await rename(join(directory, "sites/sample"), join(directory, "../sample"));
  await assert.rejects(build(), /Unknown internal link \/practice\/sample\//);
  await rename(join(directory, "../sample"), join(directory, "sites/sample"));

  const glossary = JSON.parse(
    await readFile(join(fixtures, "glossary.json"), "utf8"),
  );
  for (const [terms, pattern] of [
    [[...glossary, ...glossary], /duplicate term 样品/],
    [[{ ...glossary[0], confusion: "" }], /confusion must be text/],
    // A term still in use cannot leave the glossary.
    [[], /Unknown term 样品|unknown term 样品/],
  ])
    await rejects([["glossary.json", () => JSON.stringify(terms)]], pattern);
  await rejects(
    [["glossary.json", () => undefined]],
    /glossary\.json: missing/,
  );
  await rejects(
    [
      [
        "sites/sample/content.json",
        json((c) => {
          c.chapters[0].terms = ["不存在"];
        }),
      ],
    ],
    /chapter start uses unknown term 不存在/,
  );
  await rejects(
    [["sites/sample/content.json", json((c) => ({ ...c, glossary: [] }))]],
    /define terms in glossary\.json/,
  );

  // Topics may link to each other; a missing resource still fails the build.
  const links = [
    [
      "sites/sample/content.json",
      json((c) => {
        c.chapters[0].blocks.push({
          type: "callout",
          text: "继续观察",
          link: { to: "../instruments/", text: "工具" },
        });
      }),
    ],
    [
      "sites/instruments/content.json",
      json((c) => {
        c.chapters[0].blocks.push({
          type: "callout",
          text: "返回",
          link: { to: "/practice/sample/start#source-1", text: "样品" },
        });
      }),
    ],
  ];
  const restoreLinks = await edit(links);
  await build();
  await rejects(
    [
      [
        "sites/instruments/content.json",
        json((c) => {
          c.chapters[0].blocks.push({
            type: "figure",
            src: "/sites/instruments/static/missing.png",
            alt: "missing",
            caption: "missing",
          });
        }),
      ],
    ],
    /unknown resource/,
  );
  await restoreLinks();
});

test("author and reader notes that share a slug both compile", async (t) => {
  const { edit, build } = await editableContent(t, [
    "sites/sample",
    "notes/reader-test",
  ]);
  const reader = await readFile(
    join(fixtures, "notes/reader-test/first.md"),
    "utf8",
  );
  await edit([
    [
      "notes/reader-test/author/first.md",
      () => reader.replace("第一篇观察", "作者观察"),
    ],
  ]);
  const { snapshot } = await build();
  const both = snapshot.notes
    .filter((note) => note.slug === "first")
    .sort((a, b) => a.author - b.author);
  assert.deepEqual(
    both.map((note) => [note.author, note.compiled.title]),
    [
      [false, "第一篇观察"],
      [true, "作者观察"],
    ],
  );
});

test("a build rejects patent data whose resources, structures or references do not resolve", async (t) => {
  const { rejects, build } = await editableContent(t, [
    "sites/sample",
    "sites/fable-patent",
  ]);
  await build();
  for (const mutate of [
    (c) =>
      (c.data.collections.examples.records[0].potency.ref.asset =
        "/sites/fable-patent/static/absent.svg"),
    (c) =>
      (c.data.synthesis.fable.routes[0].evidence[0].asset =
        "/sites/fable-patent/static/absent.svg"),
    (c) => (c.data.collections.examples.records[0].potency.assay = "unknown"),
    (c) =>
      (c.data.synthesis.fable.steps[0].reactants = [
        { collection: "examples", id: 3 },
      ]),
    (c) => (c.data.collections.examples.records[0].body.key = "absent"),
    (c) => (c.data.claims.main.claims[0].scope.smarts = "["),
    (c) =>
      (c.data.collections.examples.records[0].structure = {
        source: "beta",
        page: 1,
        rect: [0, 0, 600, 820],
      }),
    (c) =>
      (c.data.collections.examples.fields.find(
        (f) => f.key === "activity",
      ).ref = {
        source: "beta",
        page: 1,
        rect: [0, 0, 595, 843],
      }),
    (c) => (c.data.collections.examples.records[0].refs.examples = [999]),
    (c) => {
      c.data.collections.examples.fields.push({
        key: "related",
        label: "相关记录",
        kind: "link",
      });
      c.data.collections.examples.records[0].related =
        "/sites/fable-patent/examples/999";
    },
  ])
    await rejects([
      [
        "sites/fable-patent/content.json",
        json((c) => {
          mutate(c);
        }),
      ],
    ]);
});

test("a build rejects citations the registry or the shelf cannot resolve", async (t) => {
  const { rejects } = await editableContent(t);
  const note = "notes/cited-reading/sources.md";
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
    [["src:reader#ch=3.1)", "src:reader)"], /an EPUB citation needs a chapter/],
    [
      ["src:reader#ch=3.1)", "src:reader#2)"],
      /an EPUB citation needs a chapter/,
    ],
    [
      ["src:reader#ch=3.1)", "src:reader#ch=9)"],
      /no chapter 9 in the navigation/,
    ],
    [["src:reader#ch=3.1)", "src:reader#ch=3.2)"], /diagram\.svg is not PNG/],
    [["sec=2)", "sec=7)"], /section 7 is not in chapter 3\.1/],
    [
      ["rect=72,300,540,420", "rect=72,300,540,900"],
      /rectangle lies outside page 2/,
    ],
    [
      ["src:handbook#4", "/materials/textbooks/sample-handbook.pdf"],
      /Unknown internal link/,
    ],
  ])
    await rejects([[note, (text) => text.replaceAll(...change)]], pattern);
  await rejects([["sources.json", () => "{}"]], /not in sources\.json/);
  await rejects(
    [
      [
        "sources.json",
        (text) => text.replace("sample-handbook.pdf", "missing-handbook.pdf"),
      ],
    ],
    /missing-handbook\.pdf: not on the shelf/,
  );
  await rejects([["sources.json", () => undefined]], /sources\.json: missing/);
  await rejects(
    [
      [
        "sites/cited-sources/content.json",
        json((c) => {
          c.sources[0].file = "textbooks/sample-handbook.pdf";
        }),
      ],
    ],
    /source 1 names a shelf file/,
  );
});
