import { defineStructureSet } from "@ui";
import raw from "./structures.json";

/** One neutral entry for the demo page: T4 lysozyme L99A with benzene in its cavity. */
export const structures = defineStructureSet({
  fetchedOn: raw.fetchedOn,
  entries: raw.entries.map((entry) => ({
    ...entry,
    url: `/showcase/${entry.id}.pdb`,
  })),
});
