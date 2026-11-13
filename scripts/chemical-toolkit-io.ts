import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { parentPort, type MessagePort } from "node:worker_threads";
import { isObject } from "../shared/json.ts";
import { pythonInterpreter } from "./python.ts";
import { fileURLToPath } from "node:url";

const interpreter = pythonInterpreter();
const python = spawn(
  interpreter,
  [
    "-I",
    "-u",
    fileURLToPath(new URL("./chemical-toolkit.py", import.meta.url)),
  ],
  { stdio: ["pipe", "pipe", "inherit"] },
);
const clients = new Map<number, { port: MessagePort; flag: Int32Array }>();
const pending = new Map<number, number>();
let sequence = 0;
let failed: string | undefined;
function reply(client: number, value: unknown) {
  const connection = clients.get(client)!;
  connection.port.postMessage(value);
  Atomics.store(connection.flag, 0, 1);
  Atomics.notify(connection.flag, 0);
}
function fail(error: string) {
  failed = error;
  for (const client of pending.values()) reply(client, { ok: false, error });
  pending.clear();
}
python.on("error", (error) => fail(error.message));
python.stdin.on("error", (error) => fail(error.message));
python.on("exit", (code, signal) =>
  fail(`Chemical toolkit exited (${signal ?? code})`),
);
const lines = createInterface({ input: python.stdout });
lines.on("line", (line) => {
  try {
    const message: unknown = JSON.parse(line);
    if (
      !isObject(message) ||
      typeof message.id !== "number" ||
      typeof message.ok !== "boolean"
    )
      throw new Error("Invalid chemical toolkit response");
    const client = pending.get(message.id);
    if (client === undefined)
      throw new Error("Unknown chemical toolkit response");
    pending.delete(message.id);
    reply(client, message);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
    python.kill();
  }
});
parentPort!.on(
  "message",
  (message: { port: MessagePort; flag: SharedArrayBuffer; client: number }) => {
    const { port, flag, client } = message;
    clients.set(client, { port, flag: new Int32Array(flag) });
    port.on("message", (request: { op: string; args: unknown[] }) => {
      if (failed) {
        reply(client, { ok: false, error: failed });
        return;
      }
      const id = ++sequence;
      pending.set(id, client);
      python.stdin.write(JSON.stringify({ id, ...request }) + "\n");
    });
    port.on("close", () => clients.delete(client));
  },
);
parentPort!.on("close", () => python.stdin.end());
parentPort!.postMessage({ ready: true });
