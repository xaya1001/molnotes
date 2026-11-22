import type {
  FigureReference,
  LibrarySnapshot,
} from "../../shared/chemical-library/types.ts";

type Change = { count: number; figures: Set<string> };

function figurePages(uses: LibrarySnapshot["uses"], ref: string) {
  const libraryPrefix = "/library/#";
  const figures = new Set([ref]);
  const pages = new Set<string>();
  for (const id of figures) {
    for (const { path } of uses[id] ?? []) {
      if (path.startsWith(libraryPrefix))
        figures.add(path.slice(libraryPrefix.length));
      else pages.add(path);
    }
  }
  return pages.size ? pages : ["Unreferenced library figures"];
}

export function formatFigureDiagnosticDeltas(
  previous: LibrarySnapshot | undefined,
  current: LibrarySnapshot | undefined,
) {
  const before = previous?.renders ?? {};
  const after = current?.renders ?? {};
  const pages = new Map<string, { added: Change; removed: Change }>();
  for (const view of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const counts = new Map<string, number>();
    for (const [render, direction] of [
      [before[view], -1],
      [after[view], 1],
    ] as const) {
      for (const { code, elements } of render?.diagnostics ?? []) {
        const key = JSON.stringify([code, elements.toSorted()]);
        counts.set(key, (counts.get(key) ?? 0) + direction);
      }
    }
    let added = 0;
    let removed = 0;
    for (const count of counts.values()) {
      if (count > 0) added += count;
      if (count < 0) removed -= count;
    }
    if (!added && !removed) continue;
    const { ref }: FigureReference = JSON.parse(view);
    for (const [kind, count, library] of [
      ["added", added, current],
      ["removed", removed, previous],
    ] as const) {
      if (!count || !library) continue;
      for (const page of figurePages(library.uses, ref)) {
        let totals = pages.get(page);
        if (!totals) {
          totals = {
            added: { count: 0, figures: new Set() },
            removed: { count: 0, figures: new Set() },
          };
          pages.set(page, totals);
        }
        totals[kind].count += count;
        totals[kind].figures.add(ref);
      }
    }
  }
  const format = ({ count, figures }: Change) =>
    count ? `${count} [${[...figures].sort().join(", ")}]` : "0";
  return [...pages.keys()].sort().map((page) => {
    const { added, removed } = pages.get(page)!;
    return `${page}: +${format(added)}, -${format(removed)}`;
  });
}
