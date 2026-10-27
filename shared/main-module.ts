import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Whether the module was started as the program itself. Real paths are
 * compared because the service is launched through the `current` link.
 */
export function isMainModule(moduleUrl: string) {
  return (
    !!process.argv[1] &&
    realpathSync(process.argv[1]) === fileURLToPath(moduleUrl)
  );
}
