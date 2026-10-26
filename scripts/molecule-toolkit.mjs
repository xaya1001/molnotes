import initRDKit from "@rdkit/rdkit";

// Publication compilers share one WASM instance, including overlapping callers.
let toolkit;
export function moleculeToolkit() {
  return (toolkit ??= initRDKit());
}
