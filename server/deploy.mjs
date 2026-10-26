import { runCommand, deploymentFailure } from "./deploy-command.mjs";
import { deploymentSmoke, containerSmokeRequest } from "./deploy-smoke.mjs";
import { measureStage } from "./stage-timing.mjs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publishedImage } from "./release-image.mjs";
import { activateRelease, prepareRelease } from "./releases.mjs";
import { systemConfig } from "./system-config.mjs";

const config = systemConfig();
const repo = config.checkout;
const repository = config.image;
const target = process.argv[2];
const shaPattern = /^[0-9a-f]{40}$/;

function deploymentError(reason) {
  const error = new Error(reason);
  error.safeReason = reason;
  return error;
}
const stages = [];
async function phase(name, operation) {
  return measureStage(
    name,
    async () => {
      try {
        return await operation();
      } catch (error) {
        error.stage ??= name;
        throw error;
      }
    },
    (event) => stages.push(event),
  );
}
async function run(name, file, args, options = {}) {
  return phase(name, () => runCommand(file, args, { cwd: repo, ...options }));
}

async function checkedMain(revision) {
  const remote = await run("verify.main", "git", [
    "-c",
    "credential.helper=!gh auth git-credential",
    "ls-remote",
    "origin",
    "refs/heads/main",
  ]);
  if (remote.split(/\s+/)[0] !== revision)
    throw deploymentError("main has changed");
  const runs = JSON.parse(
    await run("verify.check", "gh", [
      "run",
      "list",
      "-R",
      config.githubRepository,
      "-w",
      "Check",
      "-c",
      revision,
      "-e",
      "push",
      "--json",
      "headSha,status,conclusion,event",
      "--limit",
      "5",
    ]),
  );
  const exact = Array.isArray(runs)
    ? runs.find((item) => item.headSha === revision && item.event === "push")
    : null;
  if (exact?.status !== "completed" || exact.conclusion !== "success") {
    throw deploymentError("main Check has not passed");
  }
}

async function smoke(includeSystem = true) {
  return deploymentSmoke({
    request: containerSmokeRequest(run, config.container),
    includeSystem,
  });
}

async function pullPublishedImage(revision) {
  const config = await mkdtemp(join(tmpdir(), "molnotes-ghcr-"));
  const env = { DOCKER_CONFIG: config };
  try {
    const token = await run("image.credentials", "gh", ["auth", "token"]);
    await run(
      "image.login",
      "docker",
      ["login", "ghcr.io", "-u", config.registryUser, "--password-stdin"],
      {
        env,
        input: token,
      },
    );
    const tag = `${repository}:${revision}`;
    await run("image.pull", "docker", ["pull", tag], { env });
    const inspected = JSON.parse(
      await run("image.inspect", "docker", ["image", "inspect", tag]),
    );
    if (inspected.length !== 1)
      throw deploymentError("expected one published image");
    return publishedImage(repository, revision, JSON.stringify(inspected[0]));
  } finally {
    await rm(config, { recursive: true, force: true });
  }
}

async function deploy() {
  if (!shaPattern.test(target)) throw deploymentError("invalid revision");
  if (
    (await run("checkout.branch", "git", ["branch", "--show-current"])) !==
    "main"
  )
    throw deploymentError("canonical checkout is not main");
  if (await run("checkout.clean", "git", ["status", "--porcelain"]))
    throw deploymentError("canonical checkout is not clean");
  await checkedMain(target);
  await run("checkout.fetch", "git", [
    "-c",
    "credential.helper=!gh auth git-credential",
    "fetch",
    "origin",
    "main",
  ]);
  if (
    (await run("checkout.fetched", "git", ["rev-parse", "FETCH_HEAD"])) !==
    target
  )
    throw deploymentError("fetched main does not match requested revision");
  await checkedMain(target);
  await run("checkout.merge", "git", ["merge", "--ff-only", "FETCH_HEAD"]);
  if ((await run("checkout.revision", "git", ["rev-parse", "HEAD"])) !== target)
    throw deploymentError("checkout does not match requested revision");
  await phase("server.prepare", () =>
    prepareRelease({ repo, root: config.releases, revision: target }),
  );

  const previous = await run("rollback.capture-image", "docker", [
    "inspect",
    config.container,
    "--format",
    "{{.Config.Image}}",
  ]);
  if (
    !/^sha256:[0-9a-f]{64}$/.test(previous) &&
    !new RegExp(
      `^${repository.replaceAll(".", "\\.")}@sha256:[0-9a-f]{64}$`,
    ).test(previous)
  )
    throw deploymentError("running image is not an immutable digest");
  const image = await pullPublishedImage(target);
  try {
    await run(
      "deploy.compose",
      "docker",
      [
        "compose",
        "-f",
        config.compose,
        "up",
        "-d",
        "--no-build",
        "--pull",
        "never",
        "--wait",
      ],
      {
        env: { MOLNOTES_IMAGE: image },
      },
    );
    await phase("deploy.smoke", () => smoke());
    const actual = await run("deploy.verify", "docker", [
      "inspect",
      config.container,
      "--format",
      '{{.Config.Image}}|{{index .Config.Labels "org.opencontainers.image.revision"}}|{{.State.Health.Status}}',
    ]);
    if (actual !== `${image}|${target}|healthy`)
      throw deploymentError(
        "running image, revision, or health does not match",
      );
    const server = await phase("server.activate", () =>
      activateRelease({ root: config.releases, revision: target }),
    );
    return { image, previous, server, result: "success" };
  } catch (error) {
    try {
      await run(
        "rollback.compose",
        "docker",
        [
          "compose",
          "-f",
          config.compose,
          "up",
          "-d",
          "--no-build",
          "--pull",
          "never",
          "--wait",
        ],
        {
          env: { MOLNOTES_IMAGE: previous },
        },
      );
      await phase("rollback.smoke", () => smoke(false));
      const restored = await run("rollback.verify", "docker", [
        "inspect",
        config.container,
        "--format",
        "{{.Config.Image}}|{{.State.Health.Status}}",
      ]);
      if (restored !== `${previous}|healthy`)
        throw deploymentError("rollback image or health does not match");
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        "deployment failed and rollback could not be verified",
      );
    }
    throw error;
  }
}

let result;
try {
  result = await phase("deploy.total", deploy);
} catch (error) {
  result = deploymentFailure(error);
  process.exitCode = 1;
}
await mkdir(config.logs, { recursive: true });
await writeFile(
  join(
    config.logs,
    `deploy-${shaPattern.test(target) ? target.slice(0, 12) : "invalid"}-${Date.now()}.json`,
  ),
  `${JSON.stringify({ revision: target, at: new Date().toISOString(), stages, ...result })}\n`,
  { mode: 0o600 },
);
