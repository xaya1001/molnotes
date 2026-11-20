import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { promisify } from "node:util";
import { containerSmokeRequest } from "../../server/system/deploy-smoke.ts";
import { isObject } from "../../shared/json.ts";

const exec = promisify(execFile);

export async function confirmServedSnapshot(
  releases: string,
  expected: string,
) {
  const signal = AbortSignal.timeout(15_000);
  let actual: string | undefined;
  let reason = "health check unavailable";
  const run = async (_stage: string, file: string, args: string[]) =>
    (await exec(file, args, { signal })).stdout.trim();

  while (!signal.aborted) {
    try {
      const container = await run("content.container", "docker", [
        "ps",
        "--filter",
        `volume=${resolve(releases)}`,
        "--format",
        "{{.ID}}",
      ]);
      if (!container || container.includes("\n")) {
        reason = "expected one running content container";
      } else {
        const request = containerSmokeRequest(run, container);
        const health: unknown = JSON.parse(await request("/healthz", true));
        if (isObject(health) && typeof health.snapshotId === "string") {
          actual = health.snapshotId;
          if (actual === expected) return;
          reason = "snapshot ID differs";
        } else {
          reason = "health check did not report a snapshot ID";
        }
      }
    } catch {
      if (!signal.aborted) reason = "health check unavailable";
    }
    if (!signal.aborted) await setTimeout(250);
  }
  throw new Error(
    `Snapshot confirmation timed out: expected ${expected}, served ${actual ?? "unknown"} (${reason})`,
  );
}
