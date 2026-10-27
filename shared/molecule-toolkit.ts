import initRDKit, { type MainModule } from "@rdkit/rdkit";

// Publication compilers share one WASM instance, including overlapping callers.
let toolkit: Promise<MainModule> | undefined;
export function moleculeToolkit() {
  return (toolkit ??= initRDKit());
}
