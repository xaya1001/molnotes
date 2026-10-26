import { spawn } from "node:child_process";
import { mkdtemp, rm, chmod } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { testDatabase } from "../tests/helpers/database.mjs";
import { assetStore } from "../server/assets.mjs";
import { pushUnits } from "../server/content-publish.mjs";
import { smokeBrowser } from "./smoke-browser.mjs";
const image = process.argv[2];
if (!/^ghcr\.io\/.+@sha256:[a-f0-9]{64}$/.test(image ?? ""))
  throw new Error("Expected an immutable image digest");
const name = `candidate-${process.env.GITHUB_RUN_ID || process.pid}-${process.env.GITHUB_RUN_ATTEMPT || 1}`;
const db = await testDatabase();
const directory = await mkdtemp(join(tmpdir(), "molnotes-smoke-"));
async function docker(args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.resume();
    child.once("error", () => reject(new Error("Docker could not start")));
    child.once("close", (code) =>
      code === 0
        ? resolve(output.trim())
        : reject(new Error(`Docker ${args[0]} failed (${code})`)),
    );
  });
}
try {
  await chmod(directory, 0o755);
  const store = await assetStore("dir:" + join(directory, "objects"));
  for (const unit of ["sites/sample", "sites/instruments", "notes/reader-test"])
    await pushUnits(db.pool, store, "tests/fixtures/content", [unit]);
  // The candidate reaches the test database published on the Docker host.
  const url = new URL(db.url);
  url.hostname = "host.docker.internal";
  await docker(
    [
      "run",
      "-d",
      "--name",
      name,
      "--add-host",
      "host.docker.internal:host-gateway",
      "--publish",
      "127.0.0.1::8080",
      "--read-only",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges:true",
      "--env",
      "MOLNOTES_DATABASE_URL",
      "--env",
      "MOLNOTES_ASSET_STORE=dir:/objects",
      "--env",
      "MOLNOTES_ASSET_CACHE=/cache",
      "--mount",
      `type=bind,src=${directory}/objects,dst=/objects,readonly`,
      "--tmpfs",
      "/cache:uid=1001,gid=1001",
      "--tmpfs",
      "/tmp",
      image,
    ],
    { MOLNOTES_DATABASE_URL: url.href },
  );
  const address = await docker(["port", name, "8080/tcp"]);
  if (!/^127\.0\.0\.1:\d+$/.test(address))
    throw new Error("Candidate address unavailable");
  const base = `http://${address}`;
  let ready = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      if ((await fetch(base + "/healthz")).ok) {
        ready = true;
        break;
      }
    } catch {
      /* Wait for migration/start. */
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!ready) throw new Error("Candidate health check failed");
  for (const path of [
    "/api/catalog",
    "/notes/reader-test/assets/sample.svg",
    "/sites/instruments/static/sample.pdb",
  ])
    if (!(await fetch(base + path)).ok)
      throw new Error(`Candidate failed: ${path}`);
  await smokeBrowser(base, "/practice/sample/", "/notes/reader-test/first");
  console.log("Candidate catalog, topic and note rendered successfully");
} finally {
  await docker(["rm", "-f", name]).catch(() => {});
  await db.close();
  await rm(directory, { recursive: true, force: true });
}
