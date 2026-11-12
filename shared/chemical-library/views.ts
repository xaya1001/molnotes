import type { FigureReference } from "./types.ts";

const stable = (value: unknown): string =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        )
      : item,
  );

export const figureViewKey = (reference: FigureReference) =>
  stable({
    ref: reference.ref,
    variant: reference.variant,
    frame: reference.frame,
    numbers: reference.numbers,
    focus: reference.focus,
  });
