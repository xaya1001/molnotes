import type {
  FigureReference,
  LibrarySnapshot,
} from "../../../shared/chemical-library/types.ts";
import { figureViewKey } from "../../../shared/chemical-library/views.ts";

/** Mount a fresh DOM tree for each consumer of the published artwork. */
export async function snapshotSvg(
  library: LibrarySnapshot,
  reference: FigureReference,
) {
  const entry = library.entries[reference.ref];
  const view =
    entry?.kind === "mechanism" && !reference.frame
      ? { ...reference, frame: entry.frames[0].id }
      : reference;
  const render = library.renders?.[figureViewKey(view)];
  if (!render) throw new Error(`Missing published figure ${reference.ref}`);
  const response = await fetch(render.asset);
  if (!response.ok)
    throw new Error(
      `Unable to load figure ${reference.ref}: ${response.status}`,
    );
  const document = new DOMParser().parseFromString(
    await response.text(),
    "image/svg+xml",
  );
  const svg = document.documentElement;
  if (!(svg instanceof SVGSVGElement) || document.querySelector("parsererror"))
    throw new Error(`Invalid figure SVG ${reference.ref}`);
  return { ...render, svg };
}
