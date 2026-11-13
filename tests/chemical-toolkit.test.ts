import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, chmod, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { Worker, MessageChannel } from "node:worker_threads";
import { pythonToolkit } from "../scripts/chemical-toolkit.ts";

// A terminated interpreter must release a caller blocked on the synchronous bridge.
test("a stopped chemical service rejects its request and the command exits", async () => {
  const root = await mkdtemp(join(tmpdir(), "chemical-service-"));
  try {
    const interpreter = join(root, "interpreter");
    await writeFile(interpreter, "#!/bin/sh\nexec 0<&-\nsleep 0.05\nexit 7\n");
    await chmod(interpreter, 0o700);
    const entry = join(root, "request.mjs");
    const toolkit = new URL("../shared/molecule-toolkit.ts", import.meta.url)
      .href;
    await writeFile(
      entry,
      `import { moleculeToolkit } from ${JSON.stringify(toolkit)};\nawait moleculeToolkit();\n`,
    );
    const result = spawnSync(process.execPath, [entry], {
      env: { ...process.env, MOLNOTES_PYTHON: interpreter },
      encoding: "utf8",
      timeout: 5000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Chemical toolkit exited \(7\)|EPIPE/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a chemical request waits for the notified response to reach its port", async () => {
  const { port1, port2 } = new MessageChannel();
  const flag = new SharedArrayBuffer(4);
  const service = new Worker(
    `
    const {workerData} = require('node:worker_threads');
    const flag = new Int32Array(workerData.flag);
    workerData.port.on('message', () => {
      Atomics.store(flag, 0, 1);
      Atomics.notify(flag, 0);
      setTimeout(() => workerData.port.postMessage({ok:true,value:null}), 5);
    });
  `,
    { eval: true, workerData: { port: port2, flag }, transferList: [port2] },
  );
  try {
    const toolkit = pythonToolkit({ port: port1, flag });
    assert.equal(toolkit.get_mol("["), null);
  } finally {
    port1.close();
    await service.terminate();
  }
});
