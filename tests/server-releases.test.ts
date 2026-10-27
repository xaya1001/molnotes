import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  stat,
  symlink,
  writeFile,
  mkdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import {
  activateRelease,
  activeRevision,
  prepareRelease,
} from "../server/system/releases.ts";

const entry = join("server", "system", "server.ts");

async function repository() {
  const repo = await mkdtemp(join(tmpdir(), "molnotes-releases-repo-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "test");
  await mkdir(join(repo, "server", "system"), { recursive: true });
  await mkdir(join(repo, "shared"));
  await mkdir(join(repo, "server", "web"));
  await writeFile(join(repo, "server", "web", "web.ts"), "// web\n");
  await writeFile(join(repo, "package.json"), '{ "type": "module" }\n');
  const commit = async (content: string) => {
    await writeFile(join(repo, "server", "system", "server.ts"), content);
    await writeFile(join(repo, "shared", "module.ts"), content);
    git("add", ".");
    git("commit", "-q", "-m", content);
    return git("rev-parse", "HEAD");
  };
  return { repo, commit };
}

test("releases are written per revision and activated by an atomic link", async () => {
  const { repo, commit } = await repository();
  const root = await mkdtemp(join(tmpdir(), "molnotes-releases-root-"));
  try {
    const first = await commit("// first\n");
    const second = await commit("// second\n");
    assert.equal(await activeRevision(root), null);

    await prepareRelease({ repo, root, revision: first });
    assert.deepEqual(await activateRelease({ root, revision: first }), {
      previous: null,
      current: first,
    });
    await prepareRelease({ repo, root, revision: second });
    assert.equal(await activeRevision(root), first);
    const active = join(root, "releases", first, entry);
    const before = (await stat(active)).ino;
    await prepareRelease({ repo, root, revision: first });
    assert.equal((await stat(active)).ino, before, "complete release reused");
    assert.deepEqual(await activateRelease({ root, revision: second }), {
      previous: first,
      current: second,
    });
    assert.equal(
      await readFile(join(root, "current", entry), "utf8"),
      "// second\n",
    );
    assert.equal(
      await readFile(join(root, "current", "shared", "module.ts"), "utf8"),
      "// second\n",
    );
    assert.deepEqual(
      (await readdir(join(root, "current", "server"))).sort(),
      ["system"],
      "the website is not part of a release",
    );
    // package.json makes the release's TypeScript modules ES modules.
    assert.deepEqual(
      JSON.parse(await readFile(join(root, "current", "package.json"), "utf8")),
      { type: "module" },
    );
    assert.equal(
      await readFile(join(root, "releases", first, entry), "utf8"),
      "// first\n",
    );

    await activateRelease({ root, revision: first });
    assert.equal(
      await readlink(join(root, "current")),
      join(root, "releases", first),
    );
    await assert.rejects(activateRelease({ root, revision: "0".repeat(40) }));
    assert.equal(await activeRevision(root), first);
  } finally {
    await rm(repo, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});

test("old releases are pruned but the active and previous ones stay", async () => {
  const { repo, commit } = await repository();
  const root = await mkdtemp(join(tmpdir(), "molnotes-releases-root-"));
  try {
    const revisions = [];
    for (let index = 0; index < 8; index++)
      revisions.push(await commit(`// ${index}\n`));
    for (const revision of revisions) {
      await prepareRelease({ repo, root, revision });
      await activateRelease({ root, revision });
    }
    assert.deepEqual(
      (await readdir(join(root, "releases"))).sort(),
      revisions.slice(3).sort(),
    );
    await activateRelease({ root, revision: revisions[3] });
    await prepareRelease({ repo, root, revision: revisions[0] });
    await activateRelease({ root, revision: revisions[0] });
    const kept = await readdir(join(root, "releases"));
    assert.ok(kept.includes(revisions[0]), "active release kept");
    assert.ok(kept.includes(revisions[3]), "previous release kept");
  } finally {
    await rm(repo, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});

test("a missing revision leaves no release behind", async () => {
  const { repo } = await repository();
  const root = await mkdtemp(join(tmpdir(), "molnotes-releases-root-"));
  try {
    await assert.rejects(
      prepareRelease({ repo, root, revision: "1".repeat(40) }),
    );
    await assert.rejects(readdir(join(root, "releases", "1".repeat(40))));
  } finally {
    await rm(repo, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});

test("server scripts run as programs when launched through the release link", async () => {
  const root = await mkdtemp(join(tmpdir(), "molnotes-releases-link-"));
  try {
    await symlink(resolve(import.meta.dirname, ".."), join(root, "current"));
    const result = spawnSync(
      process.execPath,
      [
        join(root, "current", "server", "system", "releases.ts"),
        "not-a-revision",
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          MOLNOTES_CHECKOUT: root,
          MOLNOTES_GITHUB_REPOSITORY: "example/molnotes",
          MOLNOTES_ORIGIN: "https://site.example.test",
          MOLNOTES_CONTAINER: "site-web",
          MOLNOTES_COMPOSE_FILE: join(root, "compose.yml"),
          MOLNOTES_SYSTEM_SOCKET: join(root, "system.sock"),
          MOLNOTES_DEPLOY_LOG_DIR: root,
          MOLNOTES_RELEASE_ROOT: root,
        },
      },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /invalid revision/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
