import { isAbsolute, join } from "node:path";
import { homedir } from "node:os";
import { environmentSetting } from "../shared/environment-setting.ts";

/** Use the same interpreter for material extraction and figure compilation. */
export function pythonInterpreter() {
  const python =
    environmentSetting("MOLNOTES_PYTHON") ??
    join(homedir(), "miniconda3", "bin", "python3");
  if (!isAbsolute(python))
    throw new Error("MOLNOTES_PYTHON must be an absolute interpreter path");
  return python;
}
