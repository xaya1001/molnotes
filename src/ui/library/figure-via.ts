import type {
  Anchor,
  AtomRef,
  Focus,
  FocusGroup,
  GraphArrow,
  Participant,
  Placement,
  Scene,
} from "../../../shared/chemical-library/types.ts";
import {
  appearances,
  graphPanels,
  type GraphPanel,
} from "../../../shared/chemical-library/figure-layout.ts";

type BoundPanel = { frame: GraphPanel; matches: Map<string, Placement> };

export function arrowViaPanels(arrow: GraphArrow, scene: Scene) {
  const via = arrow.via;
  const panels = via ? graphPanels(via) : [];
  const byId = new Map(
    scene.molecules.map((placement) => [placement.id, placement]),
  );
  const match = (
    panel: (typeof panels)[number] | undefined,
    bindings: Record<string, string> | undefined,
    participants: Participant[],
  ) => {
    if (!panel || !bindings || !panel.scene.molecules.length) return;
    const located = new Map(
      participants.map((p) => [p.sourceKey, byId.get(p.id)]),
    );
    const matches = new Map<string, Placement>();
    for (const [outer, inner] of Object.entries(bindings)) {
      const placement = located.get(outer);
      const prefix = panel.id + "/";
      if (placement && inner.startsWith(prefix))
        matches.set(inner.slice(prefix.length), placement);
    }
    if (
      panel.scene.molecules.every(
        ({ id, compound }) => matches.get(id)?.compound === compound,
      )
    )
      return {
        frame: panel,
        matches,
        outgoing: Object.entries(via!.arrows).find(([, edge]) =>
          edge.from.some(({ state }) => state === panel.id),
        ),
      };
  };
  const start = match(panels[0], via?.bind?.from, appearances(arrow.from));
  const end =
    panels.at(-1) !== start?.frame
      ? match(panels.at(-1), via?.bind?.to, appearances(arrow.to))
      : undefined;
  return {
    start,
    end,
    middle: panels.slice(start ? 1 : 0, end ? -1 : undefined),
  };
}

export function mergeBoundAnnotations(
  scene: Scene,
  prefix: string,
  focus: Focus | undefined,
  endpoints: BoundPanel[],
) {
  const merged = { ...scene };
  const aliases = new Map<string, string>();
  const annotated = new Set<string>();
  const primary: FocusGroup[] = scene.focus?.primary
    ? [scene.focus.primary]
    : [];
  const supporting = [...(scene.focus?.supporting ?? [])];
  for (const { frame, matches } of endpoints) {
    const qualify = (id: string) => frame.id + "/" + id;
    const atom = (ref: AtomRef): AtomRef => ({
      ...ref,
      molecule: matches.get(ref.molecule)!.id,
    });
    const pair = ([a, b]: [AtomRef, AtomRef]): [AtomRef, AtomRef] => [
      atom(a),
      atom(b),
    ];
    const anchor = (ref: Anchor): Anchor =>
      ref.kind === "lonePair"
        ? { ...ref, label: qualify(ref.label) }
        : "at" in ref
          ? { ...ref, at: atom(ref.at) }
          : { ...ref, atoms: pair(ref.atoms) };
    const group = (value: FocusGroup): FocusGroup => ({
      atoms: value.atoms?.map(atom),
      bonds: value.bonds?.map(pair),
      arrows: value.arrows?.map(qualify),
    });
    for (const [id, placement] of matches)
      aliases.set(prefix + qualify(id), prefix + placement.id);
    const overlay = frame.scene;
    if (
      overlay.arrows?.length ||
      overlay.labels?.length ||
      overlay.partialBonds?.length
    ) {
      const variants = new Map(
        overlay.molecules.map((p) => [matches.get(p.id)!.id, p.variant]),
      );
      merged.molecules = merged.molecules.map((p) =>
        variants.has(p.id) ? { ...p, variant: variants.get(p.id) } : p,
      );
      for (const placement of matches.values()) annotated.add(placement.id);
    }
    if (overlay.labels?.length)
      merged.labels = [
        ...(merged.labels ?? []),
        ...overlay.labels.map((label) => ({
          ...label,
          id: qualify(label.id),
          at: atom(label.at),
        })),
      ];
    if (overlay.arrows?.length)
      merged.arrows = [
        ...(merged.arrows ?? []),
        ...overlay.arrows.map((arrow) => ({
          ...arrow,
          id: qualify(arrow.id),
          from: anchor(arrow.from),
          to: anchor(arrow.to),
        })),
      ];
    if (overlay.partialBonds?.length)
      merged.partialBonds = [
        ...(merged.partialBonds ?? []),
        ...overlay.partialBonds.map((bond) => ({
          ...bond,
          atoms: pair(bond.atoms),
        })),
      ];
    if (overlay.enclose?.length)
      merged.enclose = [
        ...(merged.enclose ?? []),
        ...overlay.enclose.map((enclosure) => ({
          ...enclosure,
          id: qualify(enclosure.id),
          atoms: enclosure.atoms?.map(atom),
          bonds: enclosure.bonds?.map(pair),
        })),
      ];
    if (overlay.focus?.primary) primary.push(group(overlay.focus.primary));
    supporting.push(...(overlay.focus?.supporting ?? []).map(group));
  }
  if (primary.length || supporting.length)
    merged.focus = {
      ...(primary.length && {
        primary: {
          atoms: primary.flatMap((group) => group.atoms ?? []),
          bonds: primary.flatMap((group) => group.bonds ?? []),
          arrows: primary.flatMap((group) => group.arrows ?? []),
        },
      }),
      supporting,
    };
  const localAtom = (ref: AtomRef): AtomRef => ({
    ...ref,
    molecule: aliases.get(ref.molecule) ?? ref.molecule,
  });
  const localGroup = (group: FocusGroup): FocusGroup => ({
    ...group,
    atoms: group.atoms?.map(localAtom),
    bonds: group.bonds?.map(([a, b]) => [localAtom(a), localAtom(b)]),
  });
  return {
    scene: merged,
    focus: focus && {
      primary: focus.primary && localGroup(focus.primary),
      supporting: focus.supporting?.map(localGroup),
    },
    aliases,
    annotated,
  };
}
