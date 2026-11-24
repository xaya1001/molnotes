import { Worker } from "node:worker_threads";
import { dedicatedChemicalConnection } from "../chemical-toolkit.ts";
import type { FigureWork, PreparedWorkerResult } from "../figure-worker.ts";
import type { FigureGeometry } from "../../shared/chemical-library/geometry.ts";
import type { Diagnostic } from "../../shared/chemical-library/types.ts";
import { isFigureDiagnostic } from "../../src/ui/library/geometry-contract.ts";
import { isObject } from "../../shared/json.ts";

function isPreparedWorkerResult(v: unknown): v is PreparedWorkerResult {
  return (
    isObject(v) &&
    typeof v.svg === "string" &&
    v.geometryBytes instanceof Uint8Array &&
    typeof v.geometryKey === "string" &&
    typeof v.width === "number" &&
    typeof v.height === "number" &&
    typeof v.minimumScale === "number" &&
    Array.isArray(v.diagnostics) &&
    v.diagnostics.every(isFigureDiagnostic)
  );
}

export function figureWorkerPool(css: string) {
  const workers: Array<Worker | undefined> = [];
  const toolkits: Array<(() => Promise<void>) | undefined> = [];
  async function work(
    command: FigureWork,
    slot: number,
  ): Promise<PreparedWorkerResult | Diagnostic[]> {
    let worker = workers[slot];
    if (!worker) {
      const { connection: chemical, close } =
        await dedicatedChemicalConnection();
      toolkits[slot] = close;
      worker = new Worker(new URL("../figure-worker.ts", import.meta.url), {
        workerData: { css, chemical },
        transferList: [chemical.port],
      });
      workers[slot] = worker;
    }
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        worker.off("message", message);
        worker.off("error", error);
        worker.off("exit", exit);
      };
      const error = (cause: Error) => {
        workers[slot] = undefined;
        cleanup();
        reject(cause);
      };
      const exit = (code: number) => {
        workers[slot] = undefined;
        error(new Error(`Figure worker exited (${code})`));
      };
      const message = (reply: unknown) => {
        cleanup();
        if (!isObject(reply) || reply.ok !== true) {
          reject(
            new Error(
              isObject(reply) && typeof reply.error === "string"
                ? reply.error
                : "Invalid figure worker result",
            ),
          );
          return;
        }
        if (command.kind === "prepare" && isPreparedWorkerResult(reply.value))
          resolve(reply.value);
        else if (
          command.kind === "diagnose" &&
          Array.isArray(reply.value) &&
          reply.value.every(isFigureDiagnostic)
        )
          resolve(reply.value);
        else reject(new Error("Invalid figure worker result"));
      };
      worker.once("message", message);
      worker.once("error", error);
      worker.once("exit", exit);
      worker.postMessage(command);
    });
  }
  return {
    async prepare(
      command: Extract<FigureWork, { kind: "prepare" }>,
      slot: number,
    ) {
      const result = await work(command, slot);
      if (Array.isArray(result)) throw new Error("Expected prepared geometry");
      return result;
    },
    async diagnose(geometry: FigureGeometry, slot: number) {
      const result = await work({ kind: "diagnose", geometry }, slot);
      if (!Array.isArray(result)) throw new Error("Expected diagnostics");
      return result;
    },
    async close() {
      await Promise.all([
        ...workers.map((worker) => worker?.terminate()),
        ...toolkits.map((close) => close?.()),
      ]);
    },
  };
}
