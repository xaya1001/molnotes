import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, chmod, symlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { buildSnapshot } from "./content/content-publish.mjs";
import { writeSnapshot } from "./content/content-snapshot.mjs";
import { smokeBrowser } from "./smoke-browser.mjs";
const image = process.argv[2];
if (!/^ghcr\.io\/.+@sha256:[a-f0-9]{64}$/.test(image ?? ""))
  throw new Error("Expected an immutable image digest");
const name = `candidate-${process.env.GITHUB_RUN_ID || process.pid}-${process.env.GITHUB_RUN_ATTEMPT || 1}`;
const directory = await mkdtemp(join(tmpdir(), "molnotes-smoke-"));
async function docker(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, {
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
  // The candidate reads a snapshot built from the fixtures as `content publish` lays it out.
  await writeSnapshot(
    join(directory, "content/fixtures"),
    await buildSnapshot("tests/fixtures/content", {
      shelf: {
        materials: resolve("tests/fixtures/shelf"),
        cache: join(directory, "shelf-cache"),
      },
    }),
  );
  await symlink("fixtures", join(directory, "content/current"));
  // The image's unprivileged user creates the record store in an empty directory.
  await mkdir(join(directory, "data"));
  await chmod(join(directory, "data"), 0o777);
  await docker([
    "run",
    "-d",
    "--name",
    name,
    "--publish",
    "127.0.0.1::8080",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges:true",
    "--mount",
    `type=bind,src=${directory}/content,dst=/content,readonly`,
    "--mount",
    `type=bind,src=${directory}/data,dst=/data`,
    "--tmpfs",
    "/tmp",
    image,
  ]);
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
      /* Wait for start. */
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
  const saved = await fetch(base + "/api/records/notes", {
    method: "PUT",
    headers: { "If-Match": '"absent"' },
    body: "{}",
  });
  if (!saved.ok) throw new Error("Candidate failed to save a record");
  await smokeBrowser(base, "/practice/sample/", "/notes/reader-test/first");
  console.log("Candidate catalog, topic and note rendered successfully");
} finally {
  await docker(["rm", "-f", name]).catch(() => {});
  await rm(directory, { recursive: true, force: true });
}
