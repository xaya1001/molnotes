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
    (await readdir(releases)).filter((name) => /^[0-9a-f]{40}$/.test(name));

  const first = await git("rev-parse", "HEAD");
  assert.match((await content(root, "publish")).stdout, /current: /);
  assert.equal(await current(), first);
  const snapshot = JSON.parse(
    await readFile(join(releases, first, "snapshot.json"), "utf8"),
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
  await assert.rejects(content(root, "publish"), /draft\.md/);
  await rm(join(repo, "content/notes/reader-test/draft.md"));
  assert.equal(await current(), first);

  // Older snapshots beyond the newest five are removed.
  const shelf = { materials, cache: join(root, "shelf-cache") };
  const published = [first];
  for (let i = 0; i < keptSnapshots; i++) {
    await commit();
    published.push(
      await publishSnapshot(join(repo, "content"), releases, { shelf }),
    );
  }
  assert.equal(await current(), published.at(-1));
  assert.deepEqual(
    (await kept()).sort(),
    published.slice(-keptSnapshots).sort(),
  );

  // Publishing the same commit again replaces its snapshot in place.
  await publishSnapshot(join(repo, "content"), releases, { shelf });
  assert.equal(await current(), published.at(-1));
  assert.equal((await kept()).length, keptSnapshots);

  const back = published.at(-3);
  await content(root, "publish", "--rollback", back.slice(0, 7));
  assert.equal(await current(), back);
  await assert.rejects(rollbackSnapshot(releases, first), /no kept snapshot/);
  assert.equal(await current(), back);
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
});
