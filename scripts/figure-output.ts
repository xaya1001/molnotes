import { isObject } from "../shared/json.ts";
import type { LibraryEntry } from "../shared/chemical-library/types.ts";

const dimensions = new Set(["x", "y", "width", "height", "textWidth"]);
const optionalLists = new Set([
  "arrows",
  "labels",
  "reactionArrows",
  "captions",
  "maps",
  "plusAt",
  "atoms",
  "bonds",
  "abbreviations",
]);
/** Keep persisted figure geometry readable and optional defaults implicit. */
export function finishFigureEntry<T extends LibraryEntry>(entry: T): T {
  function visit(value: unknown) {
    if (Array.isArray(value)) value.forEach(visit);
    else if (isObject(value)) {
      for (const [key, child] of Object.entries(value)) {
        visit(child);
        if (child === undefined) delete value[key];
        if (typeof child === "number" && dimensions.has(key))
          value[key] = Number(child.toFixed(3)) + 0;
        if (Array.isArray(child) && !child.length && optionalLists.has(key))
          delete value[key];
      }
      if (isObject(value.primary) && !Object.keys(value.primary).length)
        delete value.primary;
      if (Array.isArray(value.supporting)) {
        const supporting = value.supporting.filter(
          (group) => !isObject(group) || Object.keys(group).length,
        );
        if (supporting.length) value.supporting = supporting;
        else delete value.supporting;
      }
      if (isObject(value.focus) && !Object.keys(value.focus).length)
        delete value.focus;
    }
  }
  visit(entry);
  return entry;
}
