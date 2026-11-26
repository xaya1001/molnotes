import assert from "node:assert/strict";
import {
  drawnArrows,
  graphPanels,
} from "../../shared/chemical-library/figure-layout.ts";
import type { LibraryEntry } from "../../shared/chemical-library/types.ts";

export function figureEntry(entry: LibraryEntry) {
  assert.equal(entry.kind, "figure");
  return entry;
}

export function arrowAt(entry: LibraryEntry, index = 0) {
  return drawnArrows(figureEntry(entry).graph)[index][1];
}

export function drawingPanels(entry: LibraryEntry) {
  const figure = figureEntry(entry);
  const panel = figure.graph.layout?.panel;
  if (panel) return [{ id: "overview", title: figure.title, scene: panel }];
  return graphPanels(figure.graph);
}

export function panelGraph(
  panels: {
    id: string;
    title?: string;
    scene: import("../../shared/chemical-library/types.ts").Scene;
  }[],
) {
  const states = Object.fromEntries(
    panels.map(({ id, ...state }) => [id, state]),
  );
  const arrows = Object.fromEntries(
    panels.slice(0, -1).map(({ id }, index) => [
      id,
      {
        from: [{ state: id }],
        to: [{ state: panels[index + 1].id }],
        role: "elementary" as const,
        kind: "forward" as const,
      },
    ]),
  );
  const views = Object.fromEntries(
    panels.map(({ id }) => [id, { items: [id] }]),
  );
  return { graph: { states, arrows }, views };
}
