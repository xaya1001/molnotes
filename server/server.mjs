import { createServer } from "node:http";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { chmodSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { isMainModule } from "./main-module.mjs";
import { systemConfig } from "./system-config.mjs";

const exec = promisify(execFile);
const shaPattern = /^[0-9a-f]{40}$/;

async function command(config, file, args) {
  const { stdout } = await exec(file, args, {
    cwd: config.checkout,
    timeout: 15000,
    maxBuffer: 256000,
  });
  return stdout.trim();
}

export async function readActualStatus(config) {
  let running = { revision: null, image: null, health: "unknown" };
  let latest = { revision: null, check: "unknown" };
  try {
    const inspect = await command(config, "docker", [
      "inspect",
      config.container,
      "--format",
      '{{.Config.Image}}|{{index .Config.Labels "org.opencontainers.image.revision"}}|{{.State.Health.Status}}',
    ]);
    const [image, revision, health] = inspect.split("|");
    running = {
      revision: shaPattern.test(revision) ? revision : null,
      image: image || null,
      health: health || "unknown",
    };
  } catch {
    // The status page remains available when Docker is unavailable.
  }
  try {
    const remote = await command(config, "git", [
      "-c",
      "credential.helper=!gh auth git-credential",
      "ls-remote",
      "origin",
      "refs/heads/main",
    ]);
    const revision = remote.split(/\s+/)[0];
    if (shaPattern.test(revision)) {
      latest = { revision, check: "unknown" };
      const output = await command(config, "gh", [
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
      ]);
      const runs = JSON.parse(output);
      if (Array.isArray(runs)) {
        const exact = runs.find(
          (run) => run.headSha === revision && run.event === "push",
        );
        latest.check =
          exact?.status !== "completed"
            ? exact
              ? "pending"
              : "unknown"
            : exact.conclusion === "success"
              ? "passed"
              : "failed";
      }
    }
  } catch {
    // A failed GitHub lookup must never enable an update.
  }
  return { running, latest };
}

function send(response, code, data) {
  response.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(data));
}

export function createSystemServer({
  readStatus,
  startUpdate,
  origin: allowedOrigin,
  log = (line) => console.error(line),
}) {
  let update = { state: "idle", target: null };
  // Rejections leave a journal line (status and reason only, never header
  // values) so a disabled or failing update button can be diagnosed later.
  function reject(response, code, error) {
    log(`update rejected ${code}: ${error}`);
    send(response, code, { error });
  }
  let operation = null;
  return createServer(async (request, response) => {
    let owned = null;
    try {
      if (request.method === "GET" && request.url === "/system/api/status") {
        const current = await readStatus();
        const canUpdate =
          operation === null &&
          current.running.health === "healthy" &&
          current.running.revision !== null &&
          current.latest.revision !== null &&
          current.running.revision !== current.latest.revision &&
          current.latest.check === "passed";
        send(response, 200, { ...current, update, canUpdate });
        return;
      }
      if (request.method === "POST" && request.url === "/system/api/update") {
        if (
          request.headers.host !== new URL(allowedOrigin).host ||
          request.headers.origin !== allowedOrigin
        ) {
          reject(response, 403, "请求来源未通过检查");
          return;
        }
        if (
          (request.headers["content-length"] &&
            request.headers["content-length"] !== "0") ||
          request.headers["transfer-encoding"]
        ) {
          reject(response, 400, "更新请求不能包含内容");
          return;
        }
        if (operation !== null) {
          reject(response, 409, "网站正在更新");
          return;
        }
        owned = {};
        operation = owned;
        update = { state: "running", target: null };
        const current = await readStatus();
        if (
          current.running.health !== "healthy" ||
          current.running.revision === null ||
          current.latest.revision === null ||
          current.running.revision === current.latest.revision ||
          current.latest.check !== "passed"
        ) {
          operation = null;
          update = { state: "idle", target: null };
          reject(response, 409, "没有已通过检查的可用更新");
          return;
        }
        const target = current.latest.revision;
        log(`update started: ${target}`);
        update = { state: "running", target };
        await startUpdate(target, (error) => {
          if (operation !== owned) return;
          operation = null;
          update = error
            ? { state: "failed", target, message: error }
            : { state: "succeeded", target, message: "网站已更新" };
        });
        send(response, 202, { target });
        return;
      }
      send(response, 404, { error: "页面不存在" });
    } catch (cause) {
      if (owned && operation === owned) {
        operation = null;
        update = {
          state: "failed",
          target: update.target,
          message: "更新未能启动",
        };
      }
      log(
        `request failed ${request.method} ${request.url}: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
      send(response, 503, { error: "系统状态暂时无法获取" });
    }
  });
}

function startActualUpdate(config, target, done) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "flock",
      [
        "-n",
        join(config.logs, "deploy.lock"),
        process.execPath,
        fileURLToPath(new URL("./deploy.mjs", import.meta.url)),
        target,
      ],
      { cwd: config.checkout, stdio: "ignore" },
    );
    child.once("error", reject);
    child.once("spawn", resolve);
    child.once("exit", (code) => {
      done(code === 0 ? null : "更新失败，请查看项目部署记录");
      if (code === 0) setTimeout(() => process.exit(0), 5000);
    });
  });
}

if (isMainModule(import.meta.url)) {
  const config = systemConfig();
  const server = createSystemServer({
    readStatus: () => readActualStatus(config),
    startUpdate: (target, done) => startActualUpdate(config, target, done),
    origin: config.origin,
  });
  rmSync(config.socket, { force: true });
  server.listen(config.socket, () => chmodSync(config.socket, 0o660));
}
