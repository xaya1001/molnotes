import { createServer, type ServerResponse } from "node:http";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { chmodSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { isMainModule } from "../../shared/main-module.ts";
import { systemConfig } from "./system-config.ts";

const exec = promisify(execFile);
const shaPattern = /^[0-9a-f]{40}$/;

type SystemConfig = ReturnType<typeof systemConfig>;
/** The running site and the newest main revision with its Check result. */
export interface SystemStatus {
  running: { revision: string | null; image: string | null; health: string };
  latest: { revision: string | null; check: string };
}
interface UpdateState {
  state: "idle" | "running" | "succeeded" | "failed";
  target: string | null;
  message?: string;
}
/** Starts deploying `target` and later reports the outcome to `done`: null or a reader-facing message. */
type StartUpdate = (
  target: string,
  done: (error: string | null) => void,
) => Promise<void>;

async function command(config: SystemConfig, file: string, args: string[]) {
  const { stdout } = await exec(file, args, {
    cwd: config.checkout,
    timeout: 15000,
    maxBuffer: 256000,
  });
  return stdout.trim();
}

export async function readActualStatus(
  config: SystemConfig,
): Promise<SystemStatus> {
  let running: SystemStatus["running"] = {
    revision: null,
    image: null,
    health: "unknown",
  };
  let latest: SystemStatus["latest"] = { revision: null, check: "unknown" };
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

function send(response: ServerResponse, code: number, data: unknown) {
  response.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(data));
}

/** Whether `current` offers a revision the update may deploy. */
const updatable = (
  current: SystemStatus,
): current is SystemStatus & { latest: { revision: string } } =>
  current.running.health === "healthy" &&
  current.running.revision !== null &&
  current.latest.revision !== null &&
  current.running.revision !== current.latest.revision &&
  current.latest.check === "passed";

export function createSystemServer({
  readStatus,
  startUpdate,
  origin: allowedOrigin,
  log = (line) => console.error(line),
}: {
  readStatus: () => Promise<SystemStatus>;
  startUpdate: StartUpdate;
  origin: string;
  log?: (line: string) => void;
}) {
  let update: UpdateState = { state: "idle", target: null };
  // A revision whose automatic deployment failed is not retried automatically;
  // the update button can still deploy it.
  let failedAutomatically: string | null = null;
  // Rejections leave a journal line (status and reason only, never header
  // values) so a disabled or failing update button can be diagnosed later.
  function reject(response: ServerResponse, code: number, error: string) {
    log(`update rejected ${code}: ${error}`);
    send(response, code, { error });
  }
  // Each update holds a fresh object; a callback only applies while it still owns it.
  let operation: object | null = null;
  /** Starts deploying `target` under the reservation `owned`. */
  async function launch(owned: object, target: string, automatic = false) {
    log(`update started${automatic ? " automatically" : ""}: ${target}`);
    update = { state: "running", target };
    await startUpdate(target, (error) => {
      if (operation !== owned) return;
      operation = null;
      if (error && automatic) failedAutomatically = target;
      update = error
        ? { state: "failed", target, message: error }
        : { state: "succeeded", target, message: "网站已更新" };
    });
    return target;
  }
  /**
   * Deploys the latest passed main revision when nothing else is running and
   * it has not failed automatically before. Returns the started target or null.
   */
  async function deployAutomatically() {
    if (operation !== null) return null;
    const owned = {};
    operation = owned;
    try {
      const current = await readStatus();
      if (
        operation !== owned ||
        !updatable(current) ||
        current.latest.revision === failedAutomatically
      ) {
        if (operation === owned) operation = null;
        return null;
      }
      return await launch(owned, current.latest.revision, true);
    } catch (cause) {
      if (operation === owned) {
        operation = null;
        update = {
          state: "failed",
          target: update.target,
          message: "更新未能启动",
        };
      }
      log(
        `automatic update failed to start: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
      return null;
    }
  }
  const server = createServer(async (request, response) => {
    let owned = null;
    try {
      if (request.method === "GET" && request.url === "/system/api/status") {
        const current = await readStatus();
        const canUpdate = operation === null && updatable(current);
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
        if (!updatable(current)) {
          operation = null;
          update = { state: "idle", target: null };
          reject(response, 409, "没有已通过检查的可用更新");
          return;
        }
        const target = await launch(owned, current.latest.revision);
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
  return Object.assign(server, { deployAutomatically });
}

function startActualUpdate(
  config: SystemConfig,
  target: string,
  done: (error: string | null) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(
      "flock",
      [
        "-n",
        join(config.logs, "deploy.lock"),
        process.execPath,
        fileURLToPath(new URL("./deploy.ts", import.meta.url)),
        target,
      ],
      { cwd: config.checkout, stdio: "ignore" },
    );
    child.once("error", reject);
    child.once("spawn", () => resolve());
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
  if (config.autoDeploySeconds)
    setInterval(server.deployAutomatically, config.autoDeploySeconds * 1000);
}
