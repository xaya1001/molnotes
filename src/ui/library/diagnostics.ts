import type {
  Diagnostic,
  Anchor,
  Point,
} from "../../../shared/chemical-library/types.ts";
function inside(p: Point, r: DOMRect, pad = 0) {
  return (
    p.x > r.left + pad &&
    p.x < r.right - pad &&
    p.y > r.top + pad &&
    p.y < r.bottom - pad
  );
}
function intersect(a: Point, b: Point, c: Point, d: Point) {
  const side = (p: Point, q: Point, r: Point) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
}
function samples(path: SVGGeometryElement) {
  const length = path.getTotalLength(),
    matrix = path.getScreenCTM();
  if (!matrix) return [];
  const n = Math.max(2, Math.ceil(length / 1.5));
  return Array.from({ length: n + 1 }, (_, i) =>
    path.getPointAtLength((length * i) / n).matrixTransform(matrix),
  );
}
export function figureDiagnostics(svg: SVGSVGElement): Diagnostic[] {
  const errors: Diagnostic[] = [];
  const object = svg.dataset.figure ?? "figure";
  const outer = svg.getBoundingClientRect();
  const scale = outer.width / svg.viewBox.baseVal.width;
  const style = getComputedStyle(svg);
  const bondLength = parseFloat(style.getPropertyValue("--chemical-bond"));
  const minBond = parseFloat(style.getPropertyValue("--chemical-min-bond"));
  const add = (
    code: string,
    elements: string[],
    message: string,
    at?: Point,
    actual?: number,
    required?: number,
  ) =>
    errors.push({
      code,
      severity: "error",
      object,
      elements,
      message,
      at,
      actual,
      required,
      field: "layout",
    });
  if (!svg.querySelector("[data-molecule]")) return errors;
  const labels = [...svg.querySelectorAll<SVGGraphicsElement>("[data-label]")]
    .filter((e) => e.getBBox().width > 0)
    .map((el) => ({
      el,
      id: el.getAttribute("data-label")!,
      r: el.getBoundingClientRect(),
    }));
  const groups = new Map<string, { id: string; r: DOMRect }>();
  for (const l of labels) {
    const prior = groups.get(l.id);
    if (!prior) groups.set(l.id, { id: l.id, r: l.r });
    else {
      const x = Math.min(prior.r.left, l.r.left),
        y = Math.min(prior.r.top, l.r.top);
      prior.r = new DOMRect(
        x,
        y,
        Math.max(prior.r.right, l.r.right) - x,
        Math.max(prior.r.bottom, l.r.bottom) - y,
      );
    }
  }
  const all = [...groups.values()];
  for (let i = 0; i < all.length; i++)
    for (const b of all.slice(i + 1)) {
      const a = all[i];
      if (
        a.r.left < b.r.right - 0.8 &&
        b.r.left < a.r.right - 0.8 &&
        a.r.top < b.r.bottom - 0.8 &&
        b.r.top < a.r.bottom - 0.8
      )
        add(
          "LABEL_OVERLAP",
          [a.id, b.id],
          "Separate labels or adjust the molecule layout",
          { x: a.r.x - outer.x, y: a.r.y - outer.y },
        );
    }
  for (const l of labels) {
    const size = parseFloat(getComputedStyle(l.el).fontSize) * scale;
    const minimum = parseFloat(
      style.getPropertyValue(
        l.el.hasAttribute("data-script")
          ? "--chemical-min-script"
          : "--chemical-min-text",
      ),
    );
    if (l.el.tagName === "text" && size < minimum - 0.2)
      add(
        "TEXT_TOO_SMALL",
        [l.id],
        "Increase scale or use horizontal scrolling",
        undefined,
        size,
        minimum,
      );
    if (
      l.r.left < outer.left - 1 ||
      l.r.top < outer.top - 1 ||
      l.r.right > outer.right + 1 ||
      l.r.bottom > outer.bottom + 1
    )
      add("CLIPPED_LABEL", [l.id], "Increase canvas margin");
  }
  if (bondLength * scale < minBond - 0.2)
    add(
      "BOND_TOO_SMALL",
      [],
      "Use a readable scale and horizontal scrolling",
      undefined,
      bondLength * scale,
      minBond,
    );
  for (const molecule of svg.querySelectorAll<SVGGElement>(
    "[data-bond-lengths]",
  )) {
    const lengths: number[] = JSON.parse(molecule.dataset.bondLengths!);
    const matrix = molecule.getScreenCTM()!;
    const minimum = Math.min(...lengths) * Math.hypot(matrix.a, matrix.b);
    if (minimum < minBond - 0.2)
      add(
        "BOND_TOO_SMALL",
        [molecule.dataset.molecule!],
        "Increase the scale or restore the saved bond geometry",
        undefined,
        minimum,
        minBond,
      );
  }
  for (const shape of svg.querySelectorAll<SVGGraphicsElement>(
    "[data-bond],[data-electron-arrow],[data-arrow-head],[data-reaction-arrow],[data-route-edge]",
  )) {
    const box = shape.getBoundingClientRect();
    if (
      box.left < outer.left - 1 ||
      box.top < outer.top - 1 ||
      box.right > outer.right + 1 ||
      box.bottom > outer.bottom + 1
    )
      add(
        "CLIPPED_INK",
        [
          shape.dataset.bond ??
            shape.dataset.electronArrow ??
            shape.dataset.arrowHead ??
            "arrow",
        ],
        "Increase canvas margin",
      );
  }
  const bonds = [...svg.querySelectorAll<SVGPathElement>("[data-bond]")].map(
    (el) => ({
      el,
      id: el.dataset.bond!,
      points: samples(el),
      own: (el.dataset.atoms ?? "").split(" "),
    }),
  );
  for (const b of bonds)
    for (const l of labels) {
      const points = b.own.includes(l.id) ? b.points.slice(4, -4) : b.points;
      if (points.some((p) => inside(p, l.r, 0.8)))
        add(
          "BOND_LABEL_OVERLAP",
          [b.id, l.id],
          "Move the label or adjust atom coordinates",
        );
    }
  const arrows = [
    ...svg.querySelectorAll<SVGPathElement>("[data-electron-arrow]"),
  ].map((el) => ({ el, id: el.dataset.electronArrow!, points: samples(el) }));
  for (const a of arrows) {
    const head = svg.querySelector<SVGPathElement>(
      `[data-arrow-head="${CSS.escape(a.id)}"]`,
    );
    const style = getComputedStyle(a.el);
    if (
      !head ||
      head.getTotalLength() < 3 ||
      style.stroke === "none" ||
      Number(style.strokeOpacity) === 0 ||
      Number(style.opacity) === 0 ||
      parseFloat(style.strokeWidth) <= 0
    )
      add("INVISIBLE_ARROW", [a.id], "Restore the arrow stroke and head");
    const source: Anchor = JSON.parse(a.el.dataset.from!),
      target: Anchor = JSON.parse(a.el.dataset.to!);
    const endpointOwns = (anchor: Anchor, own: string[]) => {
      const atomKey = (ref: { molecule: string; atom: string }) =>
        `${a.el.dataset.prefix ?? ""}${ref.molecule}:${ref.atom}`;
      if (anchor.kind === "bond")
        return anchor.atoms.every((ref) => own.includes(atomKey(ref)));
      if (anchor.kind === "atom" || anchor.kind === "charge")
        return own.includes(atomKey(anchor.at));
      return false;
    };
    let length = 0;
    for (let i = 1; i < a.points.length; i++)
      length += Math.hypot(
        a.points[i].x - a.points[i - 1].x,
        a.points[i].y - a.points[i - 1].y,
      );
    if (length < 0.65 * bondLength * scale)
      add(
        "ARROW_TOO_SHORT",
        [a.id],
        "Move molecules apart or extend the curve",
        undefined,
        length,
        0.65 * bondLength * scale,
      );
    const headPoints = head ? samples(head) : [];
    for (const l of labels)
      if (headPoints.some((p) => inside(p, l.r, 0.5)))
        add(
          "ARROW_HEAD_OVERLAP",
          [a.id, l.id],
          "Move the arrow head away from labels",
        );
    for (const l of labels)
      if (a.points.some((p) => inside(p, l.r, 0.5)))
        add(
          "ARROW_LABEL_OVERLAP",
          [a.id, l.id],
          "Adjust the arrow tangent or label offset",
        );
    for (const b of bonds) {
      let hit = false;
      for (let i = 1; i < a.points.length && !hit; i++) {
        const start = a.points[0],
          end = a.points.at(-1)!,
          p = a.points[i];
        if (
          (endpointOwns(source, b.own) &&
            Math.hypot(p.x - start.x, p.y - start.y) <
              0.25 * bondLength * scale) ||
          (endpointOwns(target, b.own) &&
            Math.hypot(p.x - end.x, p.y - end.y) < 0.25 * bondLength * scale)
        )
          continue;
        for (let j = 1; j < b.points.length; j++)
          if (
            intersect(
              a.points[i - 1],
              a.points[i],
              b.points[j - 1],
              b.points[j],
            )
          ) {
            hit = true;
            break;
          }
      }
      if (hit)
        add(
          "ARROW_BOND_CROSSING",
          [a.id, b.id],
          "Adjust the curve or molecule placement",
        );
    }
  }
  for (let k = 0; k < arrows.length; k++)
    for (const b of arrows.slice(k + 1)) {
      const a = arrows[k];
      let hit = false;
      for (let i = 1; i < a.points.length && !hit; i++)
        for (let j = 1; j < b.points.length; j++)
          if (
            intersect(
              a.points[i - 1],
              a.points[i],
              b.points[j - 1],
              b.points[j],
            )
          ) {
            hit = true;
            break;
          }
      if (hit)
        add("ARROW_CROSSING", [a.id, b.id], "Separate electron-flow curves");
    }
  return errors.filter(
    (e, i) =>
      errors.findIndex(
        (x) => x.code === e.code && x.elements.join() === e.elements.join(),
      ) === i,
  );
}
