import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const setup = fileURLToPath(
  new URL("../scripts/worktree-setup.ts", import.meta.url),
);

test("setup replaces the config link with a directory and refreshes its contents", () => {
  const temp = mkdtempSync(join(tmpdir(), "worktree-setup-"));
  try {
    const checkout = join(temp, "checkout");
    const companion = `${checkout}-private`;
    const source = join(companion, ".codex");
    const destination = join(checkout, ".codex");
    const bin = join(temp, "bin");
    mkdirSync(checkout);
    mkdirSync(source, { recursive: true });
    mkdirSync(bin);
    writeFileSync(join(bin, "worktree-deps"), "#!/bin/sh\nexit 0\n", {
      mode: 0o755,
    });
    execFileSync("git", ["init", "--quiet", checkout]);
    writeFileSync(join(source, "config.toml"), "value = 1\n");
    const external = join(temp, "external");
    mkdirSync(external);
    writeFileSync(join(external, "value.txt"), "external\n");
    symlinkSync(external, join(source, "external"));
    symlinkSync(join("private", ".codex"), destination);
    const run = () =>
      execFileSync(process.execPath, [setup], {
        cwd: checkout,
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      });

    run();
    assert.ok(lstatSync(destination).isDirectory());
    assert.equal(
      readFileSync(join(destination, "config.toml"), "utf8"),
      "value = 1\n",
    );
    assert.ok(lstatSync(join(destination, "external")).isSymbolicLink());
    assert.equal(readlinkSync(join(destination, "external")), external);
    for (const name of ["private", "AGENTS.md", ".claude"])
      assert.ok(lstatSync(join(checkout, name)).isSymbolicLink());

    writeFileSync(join(destination, "stale.txt"), "stale\n");
    writeFileSync(join(source, "config.toml"), "value = 2\n");
    run();
    assert.equal(
      readFileSync(join(destination, "config.toml"), "utf8"),
      "value = 2\n",
    );
    assert.equal(existsSync(join(destination, "stale.txt")), false);
    assert.equal(
      readFileSync(join(external, "value.txt"), "utf8"),
      "external\n",
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
