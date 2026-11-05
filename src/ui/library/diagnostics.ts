import {
  angleBetween,
  polygonHitsSegment,
  polygonsOverlap,
} from "./arrow-layout.ts";
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
  if (!matrix || !length) return [];
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
  const charges = new Map<string, number>();
  for (const marker of svg.querySelectorAll<SVGGraphicsElement>(
    "[data-charge-owner]",
  )) {
    const owner = marker.dataset.chargeOwner!;
    charges.set(owner, (charges.get(owner) ?? 0) + 1);
  }
  for (const [owner, count] of charges)
    if (count > 1)
      add(
        "DUPLICATE_CHARGE",
        [owner],
        "Display one charge marker per atom",
        undefined,
        count,
        1,
      );
  const labels = [...svg.querySelectorAll<SVGGraphicsElement>("[data-label]")]
    .filter((e) => e.getBBox().width > 0)
    .map((el) => ({
      el,
      id: el.getAttribute("data-label")!,
      r: el.getBoundingClientRect(),
    }));
  const groups = new Map<string, { id: string; r: DOMRect }>();
  for (const l of labels) {
    const id = l.el.dataset.chargeOwner ?? l.id;
    const prior = groups.get(id);
    if (!prior) groups.set(id, { id, r: l.r });
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
      const points = b.points;
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
  for (const edge of svg.querySelectorAll<SVGPathElement>(
    "[data-route-edge]",
  )) {
    const points = samples(edge);
    for (const label of labels)
      if (points.some((p) => inside(p, label.r, 0.5)))
        add(
          "ROUTE_EDGE_LABEL_OVERLAP",
          [edge.dataset.routeEdge!, label.id],
          "Move the route connection clear of labels",
        );
  }
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
      if (anchor.kind === "bond" || anchor.kind === "pi")
        return anchor.atoms.every((ref) => own.includes(atomKey(ref)));
      if (
        anchor.kind === "atom" ||
        anchor.kind === "charge" ||
        anchor.kind === "radical"
      )
        return own.includes(atomKey(anchor.at));
      return false;
    };
    const headPoints = head ? samples(head) : [];
    // The visible shaft ends at the filled head's rear edge. Include the
    // remaining distance to its tip when measuring the whole arrow.
    let length = headPoints.length
      ? Math.hypot(
          headPoints[0].x - a.points.at(-1)!.x,
          headPoints[0].y - a.points.at(-1)!.y,
        )
      : 0;
    for (let i = 1; i < a.points.length; i++)
      length += Math.hypot(
        a.points[i].x - a.points[i - 1].x,
        a.points[i].y - a.points[i - 1].y,
      );
    if (length < 1.2 * bondLength * scale)
      add(
        "ARROW_TOO_SHORT",
        [a.id],
        "Move molecules apart or extend the curve",
        undefined,
        length,
        1.2 * bondLength * scale,
      );
    if (headPoints.length) {
      const start = a.points[0],
        tip = headPoints[0],
        chord = Math.hypot(tip.x - start.x, tip.y - start.y),
        short =
          chord < 1.2 * bondLength * scale ||
          ((source.kind === "bond" || source.kind === "pi") &&
            target.kind === "bond");
      if (short) {
        const height = Math.max(
          ...a.points.map(
            (p) =>
              Math.abs(
                (tip.x - start.x) * (p.y - start.y) -
                  (tip.y - start.y) * (p.x - start.x),
              ) / chord,
          ),
        );
        if (height < 0.45 * bondLength * scale - 0.2)
          add(
            "ARROW_TOO_FLAT",
            [a.id],
            "Raise the arc clear of the bonds",
            undefined,
            height,
            0.45 * bondLength * scale,
          );
      }
    }
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
  const heads = [
    ...svg.querySelectorAll<SVGPathElement>("[data-head-points]"),
  ].map((el) => {
    const matrix = el.getScreenCTM()!;
    return {
      el,
      id: el.dataset.arrowHead ?? el.dataset.reactionHead!,
      points: (JSON.parse(el.dataset.headPoints!) as Point[]).map((p) =>
        new DOMPoint(p.x, p.y).matrixTransform(matrix),
      ),
    };
  });
  const ink = [
    ...svg.querySelectorAll<SVGPathElement>(
      "[data-bond],[data-electron-arrow],[data-reaction-arrow],[data-route-edge]",
    ),
  ].map((el) => ({
    el,
    id:
      el.dataset.bond ??
      el.dataset.electronArrow ??
      el.dataset.reactionArrow ??
      el.dataset.routeEdge!,
    points: samples(el),
    radius: (parseFloat(getComputedStyle(el).strokeWidth) * scale) / 2,
  }));
  for (const head of heads) {
    const own = ink.filter(
      (line) => line.id === head.id && line.el.dataset.curvePoints,
    );
    const notch = head.points[2],
      tip = head.points[0];
    own.sort((a, b) => {
      const endA = a.points.at(-1)!,
        endB = b.points.at(-1)!;
      return (
        Math.hypot(endA.x - notch.x, endA.y - notch.y) -
        Math.hypot(endB.x - notch.x, endB.y - notch.y)
      );
    });
    if (own.length) {
      const line = own[0],
        matrix = line.el.getScreenCTM()!;
      const curve = (JSON.parse(line.el.dataset.curvePoints!) as Point[]).map(
        (p) => new DOMPoint(p.x, p.y).matrixTransform(matrix),
      );
      const [p0, p1, p2, end] = curve;
      const angle = angleBetween(
        { x: end.x - p2.x, y: end.y - p2.y },
        { x: tip.x - notch.x, y: tip.y - notch.y },
      );
      if (angle >= 5)
        add(
          "ARROW_HEAD_ANGLE",
          [head.id],
          "Align the visible shaft tangent with the head axis",
          undefined,
          angle,
          5,
        );
      if (line.el.dataset.electronArrow) {
        const t = Math.min(
            0.5,
            (bondLength * scale * 0.15) /
              (3 * Math.hypot(p1.x - p0.x, p1.y - p0.y)),
          ),
          u = 1 - t;
        const derivative = {
          x:
            u * u * (p1.x - p0.x) +
            2 * u * t * (p2.x - p1.x) +
            t * t * (end.x - p2.x),
          y:
            u * u * (p1.y - p0.y) +
            2 * u * t * (p2.y - p1.y) +
            t * t * (end.y - p2.y),
        };
        const tailAngle = angleBetween(
          { x: p1.x - p0.x, y: p1.y - p0.y },
          derivative,
        );
        if (tailAngle >= 5)
          add(
            "ARROW_TAIL_ANGLE",
            [head.id],
            "Keep the initial shaft aligned with its departure direction",
            undefined,
            tailAngle,
            5,
          );
      }
    }
    for (const l of labels) {
      const r = l.r,
        box = [
          { x: r.left, y: r.top },
          { x: r.right, y: r.top },
          { x: r.right, y: r.bottom },
          { x: r.left, y: r.bottom },
        ];
      if (polygonsOverlap(head.points, box))
        add(
          "ARROW_HEAD_OVERLAP",
          [head.id, l.id],
          "Move the full arrow head away from labels",
        );
    }
    for (const line of ink) {
      if (line.id === head.id && !line.el.hasAttribute("data-bond")) continue;
      if (
        line.points
          .slice(1)
          .some((p, i) =>
            polygonHitsSegment(head.points, line.points[i], p, line.radius),
          )
      )
        add(
          line.el.hasAttribute("data-bond")
            ? "ARROW_HEAD_BOND_OVERLAP"
            : "ARROW_HEAD_ARROW_OVERLAP",
          [head.id, line.id],
          "Move the full arrow head into free space",
        );
    }
  }
  for (let i = 0; i < heads.length; i++)
    for (const b of heads.slice(i + 1))
      if (polygonsOverlap(heads[i].points, b.points))
        add(
          "ARROW_HEAD_ARROW_OVERLAP",
          [heads[i].id, b.id],
          "Separate the arrow heads",
        );
  return errors.filter(
    (e, i) =>
      errors.findIndex(
        (x) => x.code === e.code && x.elements.join() === e.elements.join(),
      ) === i,
  );
}
