import { isObject } from "../../shared/json.ts";
import type { DeploymentError } from "./deploy-command.ts";

type Run = (name: string, file: string, args: string[]) => Promise<string>;
/** Requests `route` from the running site; with `body` it returns the response body. */
export type SmokeRequest = (route: string, body?: boolean) => Promise<string>;

function failure(reason: string) {
  const error: DeploymentError = new Error(reason);
  error.safeReason = reason;
  return error;
}

/** request returns a response body for catalog/HTML and checks status for other routes. */
export async function deploymentSmoke({
  request,
  includeSystem = true,
}: {
  request: SmokeRequest;
  includeSystem?: boolean;
}) {
  await request("/healthz");
  const home = await request("/", true);
  if (!/<html[\s>]/i.test(home))
    throw failure("home smoke did not return HTML");
  // The catalog is checked field by field below.
  let catalog: unknown;
  try {
    catalog = JSON.parse(await request("/api/catalog", true));
  } catch {
    throw failure("catalog smoke failed");
  }
  try {
    if (
      !isObject(catalog) ||
      !Array.isArray(catalog.sites) ||
      !Array.isArray(catalog.groups) ||
      !Array.isArray(catalog.directories)
    )
      throw new Error();
    for (const site of catalog.sites) {
      if (
        !site ||
        typeof site.slug !== "string" ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(site.slug) ||
        typeof site.group !== "string" ||
        !catalog.groups.includes(site.group)
      )
        throw new Error();
    }
    if (
      new Set(catalog.sites.map((site) => site.slug)).size !==
      catalog.sites.length
    )
      throw new Error();
  } catch {
    throw failure("catalog smoke returned invalid data");
  }
  const site = (catalog as { sites: { slug: string; group: string }[] })
    .sites[0];
  if (site) {
    await request(`/api/topics/${site.slug}`);
    const path = site.group === "练习" ? "practice" : "sites";
    const html = await request(`/${path}/${site.slug}/`, true);
    if (!/<html[\s>]/i.test(html))
      throw failure("topic smoke did not return HTML");
  }
  if (includeSystem) await request("/system/api/status");
}

/** Keep topic bodies out of command output: a published topic may exceed its capture limit. */
export function containerSmokeRequest(
  run: Run,
  container: string,
): SmokeRequest {
  return (route, body = false) =>
    run("smoke.http", "docker", [
      "exec",
      container,
      "wget",
      "-q",
      "-O",
      body ? "-" : "/dev/null",
      `http://127.0.0.1:8080${route}`,
    ]);
}
