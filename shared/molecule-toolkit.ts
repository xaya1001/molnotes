import { loadPythonToolkit } from "../scripts/chemical-toolkit.ts";
import type { PythonToolkit } from "../scripts/chemical-toolkit.ts";

let toolkit: Promise<PythonToolkit> | undefined;
/** Publication compilers and their figure workers share one Python RDKit service. */
export function moleculeToolkit() {
  return (toolkit ??= loadPythonToolkit());
}
