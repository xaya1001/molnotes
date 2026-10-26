import scriptUrl from "@rdkit/rdkit?url";
import wasmUrl from "@rdkit/rdkit/RDKit_minimal.wasm?url";
import type { ChemistryToolkit } from "./rdkit";
declare global {
  interface Window {
    initRDKitModule?: (options: {
      locateFile: (name: string) => string;
    }) => Promise<ChemistryToolkit>;
  }
}
let pending: Promise<ChemistryToolkit> | undefined;
export function loadToolkit() {
  if (!pending)
    pending = new Promise<ChemistryToolkit>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = scriptUrl;
      script.onload = () => {
        if (!window.initRDKitModule) {
          reject(new Error("RDKit 初始化入口缺失"));
          return;
        }
        window
          .initRDKitModule({ locateFile: () => wasmUrl })
          .then(resolve, reject);
      };
      script.onerror = () =>
        reject(new Error("RDKit 程序加载失败，请检查连接后重试"));
      document.head.append(script);
    }).catch((error: unknown) => {
      pending = undefined;
      throw error;
    });
  return pending;
}
