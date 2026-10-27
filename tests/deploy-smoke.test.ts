import assert from "node:assert/strict";
import test from "node:test";
import {
  containerSmokeRequest,
  deploymentSmoke,
} from "../server/system/deploy-smoke.ts";

const site = (group = "专利拆解") => ({
  slug: "sample",
  title: "Sample",
  description: "Sample topic",
  order: 1,
  group,
});
function harness(
  sites: unknown[] = [site()],
  overrides: Record<string, string | Error> = {},
) {
  const visited: string[] = [];
  const responses: Record<string, string | Error> = {
    "/": "<!doctype html><html lang='zh'><body></body></html>",
    "/api/catalog": JSON.stringify({
      sites,
      groups: ["练习", "专利拆解"],
      directories: [],
    }),
    "/sites/sample/": "<html></html>",
    "/practice/sample/": "<html></html>",
    ...overrides,
  };
  return {
    visited,
    request: async (route: string) => {
      visited.push(route);
      const value = responses[route];
      if (value instanceof Error) throw value;
      return value ?? "";
    },
  };
}

test("deployment checks a live topic API and its group-specific HTML route", async () => {
  for (const group of ["练习", "专利拆解"]) {
    const h = harness([site(group)]);
    await deploymentSmoke(h);
    assert.deepEqual(h.visited, [
      "/healthz",
      "/",
      "/api/catalog",
      "/api/topics/sample",
      `/${group === "练习" ? "practice" : "sites"}/sample/`,
      "/system/api/status",
    ]);
  }
});

test("an empty catalog is a valid deployment and rollback excludes only system status", async () => {
  const empty = harness([]);
  await deploymentSmoke(empty);
  assert.deepEqual(empty.visited, [
    "/healthz",
    "/",
    "/api/catalog",
    "/system/api/status",
  ]);
  const rollback = harness();
  await deploymentSmoke({ ...rollback, includeSystem: false });
  assert.ok(rollback.visited.includes("/api/topics/sample"));
  assert.ok(!rollback.visited.includes("/system/api/status"));
});

test("malformed catalog and failures of an existing topic fail smoke", async () => {
  for (const raw of [
    "not JSON",
    "null",
    "[]",
    "{}",
    '{"sites":{}}',
    JSON.stringify({
      sites: [{ ...site(), slug: "../bad" }],
      groups: ["练习", "专利拆解"],
      directories: [],
    }),
    JSON.stringify({
      sites: [site(), site()],
      groups: ["练习", "专利拆解"],
      directories: [],
    }),
  ])
    await assert.rejects(deploymentSmoke(harness([], { "/api/catalog": raw })));
  for (const route of [
    "/healthz",
    "/",
    "/api/catalog",
    "/api/topics/sample",
    "/sites/sample/",
    "/system/api/status",
  ])
    await assert.rejects(
      deploymentSmoke(harness(undefined, { [route]: new Error("HTTP 503") })),
    );
  for (const route of ["/", "/sites/sample/"])
    await assert.rejects(
      deploymentSmoke(harness(undefined, { [route]: "not HTML" })),
    );
});

test("container transport checks status without capturing potentially large topic bodies", async () => {
  const calls: [string, string, string[]][] = [];
  const request = containerSmokeRequest(async (...args) => {
    calls.push(args);
    return "result";
  }, "site-web");
  assert.equal(await request("/api/topics/sample"), "result");
  await request("/api/catalog", true);
  assert.deepEqual(
    calls.map(([, file, args]) => [file, args]),
    [
      [
        "docker",
        [
          "exec",
          "site-web",
          "wget",
          "-q",
          "-O",
          "/dev/null",
          "http://127.0.0.1:8080/api/topics/sample",
        ],
      ],
      [
        "docker",
        [
          "exec",
          "site-web",
          "wget",
          "-q",
          "-O",
          "-",
          "http://127.0.0.1:8080/api/catalog",
        ],
      ],
    ],
  );
});
