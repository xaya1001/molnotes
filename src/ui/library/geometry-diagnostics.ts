import {
  angleBetween,
  insidePolygon,
  polygonHitsSegment,
  polygonsOverlap,
  polylinesTouch,
} from "./geometry-collision.ts";
import type {
  Diagnostic,
  Anchor,
  Point,
} from "../../../shared/chemical-library/types.ts";
import type {
  FigureGeometry,
  FigureMatrix,
  FigureNode,
} from "../../../shared/chemical-library/geometry.ts";
import {
  multiplyMatrix,
  mainRowBox,
  transformBox,
  transformPoint,
} from "./geometry-math.ts";
import type { FigureStyle } from "./scene-geometry.ts";
import type { FigureRect } from "../../../shared/chemical-library/geometry.ts";
import { rectangle } from "./geometry-math.ts";
import { walkGeometry } from "./geometry-walk.ts";
import {
  samplePath,
  pathMetrics,
  inkIntersectsBox,
  pathContours,
  contoursCoverPoint,
  contoursContainPoint,
  contoursContainBox,
} from "./path-geometry.ts";
interface Measured {
  node: FigureNode;
  kind: string;
  data: Record<string, string>;
  localBounds: FigureRect;
  bounds: FigureRect;
  matrix: FigureMatrix;
  length: number;
}
function inside(p: Point, r: FigureRect, pad = 0) {
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
function samples(el: Measured) {
  return el.node.kind === "path" ? samplePath(el.node.d, 1.5, el.matrix) : [];
}
function styleOf(el: Measured) {
  const p = el.node.paint;
  return {
    ...p,
    strokeWidth: String(p.strokeWidth),
    fontSize: el.node.kind === "text" ? String(el.node.fontSize) : "0",
  };
}
export function figureGeometryDiagnostics(
  geometry: FigureGeometry,
  style: FigureStyle,
  scale = 1,
): Diagnostic[] {
  const errors: Diagnostic[] = [];
  const object = geometry.root.attributes["data-figure"] ?? "figure";
  const outer = rectangle(
    0,
    0,
    geometry.width * scale,
    geometry.height * scale,
  );
  const bondLength = parseFloat(style.values["--chemical-bond"]),
    minBond = parseFloat(style.values["--chemical-min-bond"]);
  const elements: Measured[] = [];
  const screen: FigureMatrix = [scale, 0, 0, scale, 0, 0];
  walkGeometry(geometry.root, (node, matrix) => {
    const b = node.bounds ?? { x: 0, y: 0, width: 0, height: 0 };
    const m = multiplyMatrix(screen, matrix),
      r = transformBox(b, m)!;
    const data = Object.fromEntries(
      Object.entries(node.attributes)
        .filter(([key]) => key.startsWith("data-"))
        .map(([key, value]) => [
          key.slice(5).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()),
          value,
        ]),
    );
    elements.push({
      node,
      kind: node.kind === "group" ? "g" : node.kind,
      data,
      localBounds: rectangle(b.x, b.y, b.width, b.height),
      bounds: rectangle(r.x, r.y, r.width, r.height),
      matrix: m,
      length: node.kind === "path" ? pathMetrics(node.d).length : 0,
    });
  });
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
  if (!elements.find((node) => node.data.molecule !== undefined)) return errors;
  const charges = new Map<string, number>();
  for (const marker of elements.filter(
    (node) => node.data.chargeOwner !== undefined,
  )) {
    const owner = marker.data.chargeOwner!;
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
  const labels = [...elements.filter((node) => node.data.label !== undefined)]
    .filter((e) => e.localBounds.width > 0)
    .map((el) => ({
      el,
      id: el.data.label!,
      r: el.bounds,
    }));
  const groups = new Map<string, { id: string; r: FigureRect }>();
  for (const l of labels) {
    const id = l.el.data.chargeOwner ?? l.id;
    const prior = groups.get(id);
    if (!prior) groups.set(id, { id, r: l.r });
    else {
      const x = Math.min(prior.r.left, l.r.left),
        y = Math.min(prior.r.top, l.r.top);
      prior.r = rectangle(
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
    const size = parseFloat(styleOf(l.el).fontSize) * scale;
    const minimum = parseFloat(
      style.values[
        l.el.data.script !== undefined
          ? "--chemical-min-script"
          : "--chemical-min-text"
      ],
    );
    if (l.el.kind === "text" && size < minimum - 0.2)
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
  for (const molecule of elements.filter(
    (node) => node.data.bondLengths !== undefined,
  )) {
    const lengths: number[] = JSON.parse(molecule.data.bondLengths!);
    const sorted = [...lengths].sort((a, b) => a - b),
      median = sorted[Math.floor(sorted.length / 2)],
      maximum = Math.max(...lengths);
    if (maximum > median * 1.5 + 0.2)
      add(
        "BOND_TOO_LONG",
        [molecule.data.molecule!],
        "Restore the stretched bond to the molecule's shared bond length",
        undefined,
        maximum / median,
        1.5,
      );
    const matrix = molecule.matrix!;
    const minimum = Math.min(...lengths) * Math.hypot(matrix[0], matrix[1]);
    if (minimum < minBond - 0.2)
      add(
        "BOND_TOO_SMALL",
        [molecule.data.molecule!],
        "Increase the scale or restore the saved bond geometry",
        undefined,
        minimum,
        minBond,
      );
  }
  for (const shape of elements.filter(
    (node) =>
      node.data.bond !== undefined ||
      node.data.electronArrow !== undefined ||
      node.data.arrowHead !== undefined ||
      node.data.reactionArrow !== undefined ||
      node.data.routeEdge !== undefined,
  )) {
    const box = shape.bounds;
    if (
      box.left < outer.left - 1 ||
      box.top < outer.top - 1 ||
      box.right > outer.right + 1 ||
      box.bottom > outer.bottom + 1
    )
      add(
        "CLIPPED_INK",
        [
          shape.data.bond ??
            shape.data.electronArrow ??
            shape.data.arrowHead ??
            "arrow",
        ],
        "Increase canvas margin",
      );
  }
  const bonds = [
    ...elements.filter((node) => node.data.bond !== undefined),
  ].map((el) => ({
    el,
    id: el.data.bond!,
    points: samples(el),
    contours: el.node.kind === "path" ? pathContours(el.node.d, el.matrix) : [],
    own: (el.data.atoms ?? "").split(" "),
  }));
  const atomPoints = new Map<string, Point>();
  for (const molecule of elements.filter(
    (node) => node.data.atomPoints !== undefined,
  )) {
    const points: Record<string, Point> = JSON.parse(molecule.data.atomPoints!);
    const matrix = molecule.matrix!;
    for (const [id, p] of Object.entries(points))
      atomPoints.set(id, transformPoint({ x: p.x, y: p.y }, matrix));
  }
  const drawnBonds = new Map<string, typeof bonds>();
  for (const bond of bonds)
    drawnBonds.set(bond.id, [...(drawnBonds.get(bond.id) ?? []), bond]);
  // Native label clipping, the final hash stroke and crossing-bond gaps can
  // leave up to a fraction of a bond between the visible ink and its owner.
  const maximumGap = bondLength * scale * 0.3;
  for (const [id, parts] of drawnBonds) {
    // A solid wedge has a tip and a broad end, represented by its contour.
    // Ordinary lines and hash strokes are checked at their actual endpoints.
    const ends = parts.flatMap((b) =>
      styleOf(b.el).fill !== "none"
        ? b.points
        : b.points.length
          ? [b.points[0], b.points.at(-1)!]
          : [],
    );
    for (const owner of new Set(parts.flatMap((b) => b.own))) {
      const centre = atomPoints.get(owner);
      const glyphs = labels.filter((l) => l.id === owner);
      // A radical dot or explicit H can sit beside a bond-bearing atom centre.
      // Contact with either the centre or its own visible label is valid.
      const gap = centre
        ? Math.min(
            ...ends.map((p) =>
              Math.min(
                Math.hypot(p.x - centre.x, p.y - centre.y),
                ...glyphs.map(({ r }) =>
                  Math.hypot(
                    Math.max(r.left - p.x, 0, p.x - r.right),
                    Math.max(r.top - p.y, 0, p.y - r.bottom),
                  ),
                ),
              ),
            ),
          )
        : Infinity;
      if (gap > maximumGap)
        add(
          "BOND_ENDPOINT_DETACHED",
          [id, owner],
          "Reconnect the drawn bond endpoint to its atom or label",
          centre ? { x: centre.x - outer.x, y: centre.y - outer.y } : undefined,
          Number.isFinite(gap) ? gap : undefined,
          maximumGap,
        );
    }
  }
  const completeLabels = new Map<string, FigureRect>();
  const labelGlyphs = new Map<string, FigureRect[]>();
  for (const { id, r: layoutBox, el } of labels) {
    const ink =
      el.node.kind === "text"
        ? transformBox(el.node.inkBounds, el.matrix)
        : null;
    const r = ink ? rectangle(ink.x, ink.y, ink.width, ink.height) : layoutBox;
    labelGlyphs.set(id, [...(labelGlyphs.get(id) ?? []), r]);
    const previous = completeLabels.get(id);
    const x = Math.min(previous?.left ?? r.left, r.left),
      y = Math.min(previous?.top ?? r.top, r.top);
    completeLabels.set(
      id,
      rectangle(
        x,
        y,
        Math.max(previous?.right ?? r.right, r.right) - x,
        Math.max(previous?.bottom ?? r.bottom, r.bottom) - y,
      ),
    );
  }
  const mainLabels = new Map(
    [...labelGlyphs].map(([id, glyphs]) => [id, mainRowBox(glyphs)]),
  );
  for (const b of bonds)
    for (const [id, r] of completeLabels) {
      const paint = b.el.node.paint;
      if (
        inkIntersectsBox(
          b.contours,
          b.own.includes(id) ? mainLabels.get(id)! : r,
          paint.stroke === "none"
            ? 0
            : paint.strokeWidth * Math.hypot(b.el.matrix[0], b.el.matrix[1]),
          paint.fill !== "none",
        )
      )
        add(
          "BOND_LABEL_OVERLAP",
          [b.id, id],
          "Move the label or adjust atom coordinates",
        );
    }
  const rings = elements.flatMap((node) =>
    node.data.atomRings ? (JSON.parse(node.data.atomRings) as string[][]) : [],
  );
  for (const id of new Set(
    labels.filter((l) => l.el.data.abbreviation).map((l) => l.id),
  )) {
    const r = completeLabels.get(id)!;
    const centre = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    if (
      rings.some(
        (ring) =>
          !ring.includes(id) &&
          insidePolygon(
            centre,
            ring.map((atom) => atomPoints.get(atom)!),
          ),
      )
    )
      add(
        "LABEL_IN_RING",
        [id],
        "Move the terminal group label outside the ring",
      );
  }
  const arrows = [
    ...elements.filter((node) => node.data.electronArrow !== undefined),
  ].map((el) => ({ el, id: el.data.electronArrow!, points: samples(el) }));
  const enclosures = elements.filter((e) => e.data.enclose !== undefined);
  const visibleAtoms = new Set([
    ...bonds.flatMap((b) => b.own),
    ...labels.map((l) => l.id),
  ]);
  for (const [index, enclosure] of enclosures.entries()) {
    if (enclosure.node.kind !== "path") continue;
    const id = enclosure.data.enclose;
    const width = enclosure.node.paint.strokeWidth * scale;
    const clearance =
      parseFloat(style.values["--chemical-enclose-gap"]) * scale;
    const selected = new Set(enclosure.data.encloseAtoms.split(" "));
    const contours = pathContours(enclosure.node.d, enclosure.matrix);
    const paths = contours.map((c) => c.points);
    for (const l of all)
      if (
        selected.has(l.id)
          ? !contoursContainBox(contours, l.r, width + 2 * clearance)
          : inkIntersectsBox(contours, l.r, width + 2 * clearance, true)
      )
        add(
          "ENCLOSURE_LABEL_OVERLAP",
          [id, l.id],
          "Keep selected labels fully inside and unselected labels outside, with a full enclosure gap",
        );
    for (const [atom, point] of atomPoints)
      if (
        selected.has(atom)
          ? !contoursContainPoint(contours, point, width + 2 * clearance)
          : visibleAtoms.has(atom) &&
            contoursCoverPoint(contours, point, width + 2 * clearance)
      )
        add(
          "ENCLOSURE_ATOM_OVERLAP",
          [id, atom],
          "Keep selected atoms inside and unselected atoms outside, with a full enclosure gap",
        );
    for (const b of bonds) {
      // A bond entering/leaving the selected group crosses its boundary by design.
      if (b.own.some((a) => selected.has(a))) continue;
      if (
        paths.some((points) =>
          polylinesTouch(
            points,
            b.points,
            (width + b.el.node.paint.strokeWidth * scale) / 2,
          ),
        )
      )
        add(
          "ENCLOSURE_BOND_OVERLAP",
          [id, b.id],
          "Move the enclosure clear of unrelated bonds",
        );
    }
    const arrowParts = elements.filter(
      (e) =>
        e.data.electronArrow !== undefined ||
        e.data.reactionArrow !== undefined ||
        e.data.routeEdge !== undefined ||
        e.data.headPoints !== undefined,
    );
    for (const a of arrowParts)
      if (
        paths.some((points) =>
          polylinesTouch(
            points,
            samples(a),
            (width + a.node.paint.strokeWidth * scale) / 2,
          ),
        ) ||
        (a.data.headPoints !== undefined &&
          paths.flat().some((p) =>
            insidePolygon(
              p,
              (JSON.parse(a.data.headPoints) as Point[]).map((q) =>
                transformPoint(q, a.matrix),
              ),
            ),
          ))
      )
        add(
          "ENCLOSURE_ARROW_OVERLAP",
          [
            id,
            a.data.electronArrow ??
              a.data.reactionArrow ??
              a.data.routeEdge ??
              a.data.arrowHead ??
              a.data.reactionHead,
          ],
          "Separate the enclosure and arrow",
        );
    for (const other of enclosures.slice(index + 1)) {
      if (other.node.kind !== "path") continue;
      const otherContours = pathContours(other.node.d, other.matrix);
      if (
        paths.some((points) =>
          otherContours.some((c) =>
            polylinesTouch(
              points,
              c.points,
              (width + other.node.paint.strokeWidth * scale) / 2,
            ),
          ),
        )
      )
        add(
          "ENCLOSURE_OVERLAP",
          [id, other.data.enclose],
          "Separate the enclosure boundaries",
        );
    }
  }
  for (const edge of elements.filter(
    (node) => node.data.routeEdge !== undefined,
  )) {
    const points = samples(edge);
    for (const label of labels)
      if (points.some((p) => inside(p, label.r, 0.5)))
        add(
          "ROUTE_EDGE_LABEL_OVERLAP",
          [edge.data.routeEdge!, label.id],
          "Move the route connection clear of labels",
        );
  }
  for (const a of arrows) {
    const head = elements.find((node) => node.data.arrowHead === a.id);
    const style = styleOf(a.el);
    if (
      !head ||
      head.length < 3 ||
      style.stroke === "none" ||
      Number(style.strokeOpacity) === 0 ||
      Number(style.opacity) === 0 ||
      parseFloat(style.strokeWidth) <= 0
    )
      add("INVISIBLE_ARROW", [a.id], "Restore the arrow stroke and head");
    const source: Anchor = JSON.parse(a.el.data.from!),
      target: Anchor = JSON.parse(a.el.data.to!);
    const endpointOwns = (anchor: Anchor, own: string[]) => {
      const atomKey = (ref: { molecule: string; atom: string }) =>
        `${a.el.data.prefix ?? ""}${ref.molecule}:${ref.atom}`;
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
        if (height < 0.35 * bondLength * scale - 0.2)
          add(
            "ARROW_TOO_FLAT",
            [a.id],
            "Raise the arc clear of the bonds",
            undefined,
            height,
            0.35 * bondLength * scale,
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
    ...elements.filter((node) => node.data.headPoints !== undefined),
  ].map((el) => {
    const matrix = el.matrix!;
    return {
      el,
      id: el.data.arrowHead ?? el.data.reactionHead!,
      points: (JSON.parse(el.data.headPoints!) as Point[]).map((p) =>
        transformPoint({ x: p.x, y: p.y }, matrix),
      ),
    };
  });
  const ink = [
    ...elements.filter(
      (node) =>
        node.data.bond !== undefined ||
        node.data.electronArrow !== undefined ||
        node.data.reactionArrow !== undefined ||
        node.data.routeEdge !== undefined,
    ),
  ].map((el) => ({
    el,
    id:
      el.data.bond ??
      el.data.electronArrow ??
      el.data.reactionArrow ??
      el.data.routeEdge!,
    points: samples(el),
    radius: (parseFloat(styleOf(el).strokeWidth) * scale) / 2,
  }));
  for (const head of heads) {
    const own = ink.filter(
      (line) => line.id === head.id && line.el.data.curvePoints,
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
        matrix = line.el.matrix!;
      const curve = (JSON.parse(line.el.data.curvePoints!) as Point[]).map(
        (p) => transformPoint({ x: p.x, y: p.y }, matrix),
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
      if (line.el.data.electronArrow) {
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
        if (tailAngle >= 12)
          add(
            "ARROW_TAIL_ANGLE",
            [head.id],
            "Keep the initial shaft aligned with its departure direction",
            undefined,
            tailAngle,
            12,
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
      if (line.id === head.id && !(line.el.data.bond !== undefined)) continue;
      if (
        line.points
          .slice(1)
          .some((p, i) =>
            polygonHitsSegment(head.points, line.points[i], p, line.radius),
          )
      )
        add(
          line.el.data.bond !== undefined
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
