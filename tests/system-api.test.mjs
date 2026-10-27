import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSystemServer } from "../server/server.mjs";

const sockets = [];
afterEach(async () => {
  for (const { server, directory } of sockets.splice(0)) {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

async function fixture(check = "passed", overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), "il-system-api-"));
  const socket = join(directory, "server.sock");
  const target = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  let starts = 0;
  const logs = [];
  const server = createSystemServer({
    origin: "https://site.example.test",
    log: (line) => logs.push(line),
    readStatus: async () => ({
      running: {
        revision: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        image: "sha256:old",
        health: "healthy",
      },
      latest: { revision: target, check },
    }),
    startUpdate: async () => {
      starts += 1;
    },
    ...overrides,
  });
  await new Promise((resolve) => server.listen(socket, resolve));
  sockets.push({ server, directory });
  async function request(path, options = {}) {
    const { request } = await import("node:http");
    return new Promise((resolve, reject) => {
      const req = request({ socketPath: socket, path, ...options }, (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () =>
          resolve({ status: res.statusCode, body: JSON.parse(body) }),
        );
      });
      req.on("error", reject);
      req.end();
    });
  }
  return { server, request, target, getStarts: () => starts, logs };
}

test("every rejected update leaves a journal line with status and reason", async () => {
  const { request, target, logs } = await fixture("pending");
  const headers = {
    host: "site.example.test",
    origin: "https://site.example.test",
  };
  await request("/system/api/update", {
    method: "POST",
    headers: { ...headers, origin: "https://elsewhere.example" },
  });
  await request("/system/api/update", { method: "POST", headers });
  assert.deepEqual(logs, [
    "update rejected 403: 请求来源未通过检查",
    "update rejected 409: 没有已通过检查的可用更新",
  ]);
  assert.ok(!logs.some((line) => line.includes("elsewhere.example")));
  const passed = await fixture();
  await passed.request("/system/api/update", { method: "POST", headers });
  assert.deepEqual(passed.logs, [`update started: ${target}`]);
});

test("reports running and eligible main revision, then accepts one update", async () => {
  const { request, target, getStarts } = await fixture();
  const status = await request("/system/api/status");
  assert.equal(status.status, 200);
  assert.equal(status.body.latest.revision, target);
  assert.equal(status.body.canUpdate, true);
  const headers = {
    host: "site.example.test",
    origin: "https://site.example.test",
  };
  assert.equal(
    (await request("/system/api/update", { method: "POST", headers })).status,
    202,
  );
  assert.equal(
    (await request("/system/api/update", { method: "POST", headers })).status,
    409,
  );
  assert.equal(getStarts(), 1);
});

test("requires same-site origin and a passed exact-main check", async () => {
  const pending = await fixture("pending");
  const headers = {
    host: "site.example.test",
    origin: "https://site.example.test",
  };
  assert.equal(
    (await pending.request("/system/api/update", { method: "POST", headers }))
      .status,
    409,
  );
  assert.equal(pending.getStarts(), 0);
  const passed = await fixture();
  assert.equal(
    (
      await passed.request("/system/api/update", {
        method: "POST",
        headers: { ...headers, origin: "https://elsewhere.example" },
      })
    ).status,
    403,
  );
  assert.equal(passed.getStarts(), 0);
});

test("reserves an update before status resolves and isolates operation callbacks", async () => {
  let release, entered;
  const waiting = new Promise((resolve) => {
    entered = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let done,
    starts = 0,
    blocked = true;
  const status = {
    running: { health: "healthy", revision: "old" },
    latest: { revision: "new", check: "passed" },
  };
  const f = await fixture("passed", {
    readStatus: async () => {
      if (blocked) {
        blocked = false;
        entered();
        await gate;
      }
      return status;
    },
    startUpdate: async (_, callback) => {
      starts++;
      done = callback;
    },
  });
  const options = {
    method: "POST",
    headers: { host: "site.example.test", origin: "https://site.example.test" },
  };
  const first = f.request("/system/api/update", options);
  await waiting;
  const second = await f.request("/system/api/update", options);
  const pendingStatus = await f.request("/system/api/status");
  assert.equal(pendingStatus.body.canUpdate, false);
  assert.deepEqual(pendingStatus.body.update, {
    state: "running",
    target: null,
  });
  blocked = false;
  release();
  await first;
  assert.equal(second.status, 409);
  assert.equal((await first).status, 202);
  assert.equal(starts, 1);
  assert.equal((await f.request("/unknown", options)).status, 404);
  assert.equal(
    (await f.request("/system/api/status")).body.update.state,
    "running",
  );
  done(null);
  assert.equal(
    (await f.request("/system/api/status")).body.update.state,
    "succeeded",
  );
  await f.request("/system/api/update", options);
  const currentDone = done;
  currentDone("failed");
  assert.equal(
    (await f.request("/system/api/status")).body.update.state,
    "failed",
  );
});

test("status, validation and start failures release reservation; stale callbacks cannot clobber new work", async () => {
  let mode = "status",
    callbacks = [];
  const f = await fixture("passed", {
    readStatus: async () => {
      if (mode === "status") throw new Error("offline");
      return {
        running: { health: "healthy", revision: "old" },
        latest: {
          revision: "new",
          check: mode === "invalid" ? "pending" : "passed",
        },
      };
    },
    startUpdate: async (_, done) => {
      callbacks.push(done);
      if (mode === "start") throw new Error("failed");
    },
  });
  const options = {
    method: "POST",
    headers: { host: "site.example.test", origin: "https://site.example.test" },
  };
  assert.equal((await f.request("/system/api/update", options)).status, 503);
  mode = "invalid";
  assert.equal((await f.request("/system/api/update", options)).status, 409);
  mode = "start";
  assert.equal((await f.request("/system/api/update", options)).status, 503);
  mode = "good";
  assert.equal((await f.request("/system/api/update", options)).status, 202);
  callbacks[0](null);
  assert.equal(
    (await f.request("/system/api/status")).body.update.state,
    "running",
  );
  mode = "status";
  assert.equal((await f.request("/system/api/status")).status, 503);
  mode = "good";
  assert.equal(
    (await f.request("/system/api/status")).body.update.state,
    "running",
  );
  callbacks[1](null);
  assert.equal(
    (await f.request("/system/api/status")).body.update.state,
    "succeeded",
  );
});

test("deploys a passed main revision automatically once, and never retries one that failed", async () => {
  let finish;
  const started = [];
  const { server, request, target, logs } = await fixture("passed", {
    startUpdate: async (revision, done) => {
      started.push(revision);
      finish = done;
    },
  });
  assert.equal(await server.deployAutomatically(), target);
  assert.deepEqual(started, [target]);
  assert.ok(logs.includes(`update started automatically: ${target}`));
  // A running update is never joined by another automatic one.
  assert.equal(await server.deployAutomatically(), null);
  assert.equal(
    (await request("/system/api/status")).body.update.state,
    "running",
  );
  finish("更新失败，请查看项目部署记录");
  assert.equal(await server.deployAutomatically(), null);
  assert.deepEqual(started, [target]);
  // The button may still deploy the revision that failed automatically.
  const manual = await request("/system/api/update", {
    method: "POST",
    headers: {
      host: "site.example.test",
      origin: "https://site.example.test",
    },
  });
  assert.equal(manual.status, 202);
  assert.deepEqual(started, [target, target]);
});

test("automatic deployment waits for a passed check", async () => {
  for (const check of ["pending", "failed", "unknown"]) {
    const { server, getStarts } = await fixture(check);
    assert.equal(await server.deployAutomatically(), null);
    assert.equal(getStarts(), 0);
  }
});
