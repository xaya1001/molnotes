import type {
  Library,
  LibraryEntry,
} from "../../../shared/chemical-library/types.ts";
export function figureDescriptions(
  library: Library,
  entry: LibraryEntry,
  frame?: string,
) {
  if (entry.kind === "mechanism")
    return entry.frames
      .filter((f) => !frame || f.id === frame)
      .map((f) => ({ title: f.title, text: f.explanation }));
  if (entry.kind === "reaction")
    return [{ title: "", text: entry.explanation }];
  if (entry.kind === "route")
    return entry.steps.map((step, index) => {
      const reaction = library[step.reaction];
      if (reaction?.kind !== "reaction")
        throw new Error(`Unknown reaction ${step.reaction}`);
      return {
        title: reaction.title,
        text: reaction.explanation,
        number: index + 1,
      };
    });
  return [];
}
