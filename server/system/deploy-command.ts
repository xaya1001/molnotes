import { spawn } from "node:child_process";

/** What a failed command reports: its category, exit code and signal only. */
export interface CommandDiagnostic {
  category: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}
/** A deployment error carries only reasons that are safe to persist. */
export type DeploymentError = Error & {
  safeReason?: string;
  diagnostic?: CommandDiagnostic;
  stage?: string;
};

// Classify stderr in memory; raw output may contain credentials or private URLs.
function category(stderr: string) {
  if (
    /unauthorized|authentication required|authentication failed|denied:|permission denied/i.test(
      stderr,
    )
  )
    return "access_denied";
  if (/no space left on device/i.test(stderr)) return "disk_full";
  if (/unhealthy|health check|healthcheck/i.test(stderr)) return "unhealthy";
  if (
    /no such host|could not resolve|connection refused|network is unreachable|i\/o timeout|tls handshake timeout/i.test(
      stderr,
    )
  )
    return "network";
  if (/manifest unknown|manifest.*not found/i.test(stderr))
    return "image_missing";
  return "command_failed";
}

export function runCommand(
  file: string,
  args: string[],
  {
    cwd,
    env,
    input,
    timeout = 900000,
  }: {
    cwd?: string;
    env?: Record<string, string>;
    input?: string;
    timeout?: number;
  } = {},
) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(file, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeout);
    let stdout = "";
    let stderr = "";
    let spawnError: string | undefined;
    // stdout and stderr are pipes, so the streams exist.
    child.stdout!.on("data", (chunk) => {
      stdout = (stdout + chunk).slice(-262144);
    });
    child.stderr!.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-16384);
    });
    // A process can exit before consuming stdin (for example failed docker login).
    child.stdin?.on("error", () => {});
    if (input !== undefined) child.stdin!.end(input);
    child.once("error", (error: NodeJS.ErrnoException) => {
      spawnError = error.code;
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0 && !spawnError && !timedOut) return resolve(stdout.trim());
      const reason = timedOut
        ? "timeout"
        : spawnError === "ENOENT"
          ? "executable_missing"
          : spawnError === "EACCES"
            ? "access_denied"
            : spawnError
              ? "spawn_failed"
              : signal
                ? "terminated"
                : category(stderr);
      const error: DeploymentError = new Error(reason);
      error.diagnostic = { category: reason, exitCode: code, signal };
      reject(error);
    });
  });
}

// Only explicit local rejection reasons and command categories are safe to persist.
export function deploymentFailure(error: unknown) {
  const failed = error as DeploymentError;
  return {
    result: "failed",
    reason:
      error instanceof AggregateError
        ? "deployment_and_rollback_failed"
        : (failed.safeReason ??
          failed.diagnostic?.category ??
          "operation_failed"),
    failures: (error instanceof AggregateError ? error.errors : [error]).map(
      (cause: DeploymentError) => ({
        stage: cause.stage ?? null,
        ...(cause.safeReason ? { reason: cause.safeReason } : {}),
        ...cause.diagnostic,
      }),
    ),
  };
}
