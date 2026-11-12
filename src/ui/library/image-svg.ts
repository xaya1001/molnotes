import type { LibraryImage } from "../../../shared/chemical-library/types.ts";

const NS = "http://www.w3.org/2000/svg";
function element<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
  text?: string,
) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text !== undefined) e.textContent = text;
  return e;
}
export async function imageSvg(entry: LibraryImage) {
  const svg = element("svg", {
    xmlns: NS,
    role: "img",
    "aria-label": entry.title,
    "data-figure": entry.id,
  });
  const href = `/library/assets/${entry.asset}`;
  const image = new Image();
  image.src = href;
  await image.decode();
  let intrinsicWidth = image.naturalWidth,
    intrinsicHeight = image.naturalHeight;
  if (entry.mime === "image/svg+xml") {
    const source = new DOMParser().parseFromString(
      await (await fetch(href)).text(),
      "image/svg+xml",
    ).documentElement;
    const box = source
      .getAttribute("viewBox")
      ?.trim()
      .split(/[ ,]+/)
      .map(Number);
    if (box?.length === 4) {
      intrinsicWidth = box[2];
      intrinsicHeight = box[3];
    }
  }
  if (intrinsicWidth !== entry.width || intrinsicHeight !== entry.height)
    throw new Error(`${entry.id}: image dimensions differ from metadata`);
  const crop = entry.crop ?? {
    x: 0,
    y: 0,
    width: entry.width,
    height: entry.height,
  };
  svg.append(
    element("image", {
      href,
      x: -crop.x,
      y: -crop.y,
      width: entry.width,
      height: entry.height,
    }),
  );
  svg.style.overflow = "hidden";
  svg.setAttribute("viewBox", `0 0 ${crop.width} ${crop.height}`);
  svg.setAttribute("width", String(crop.width));
  svg.setAttribute("height", String(crop.height));
  return {
    svg,
    width: crop.width,
    height: crop.height,
    atomPoints: {},
    minimumScale: 0,
  };
}
