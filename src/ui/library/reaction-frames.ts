import type {
  Anchor,
  AtomRef,
  Focus,
  FocusGroup,
  Mechanism,
  Participant,
  Placement,
  Reaction,
  Scene,
} from "../../../shared/chemical-library/types.ts";

type Frame = Mechanism["frames"][number];

function matchEndpoint(
  frame: Frame,
  participants: Participant[],
  scene: Scene,
) {
  const placements = new Map(scene.molecules.map((p) => [p.id, p]));
  const unused = participants.flatMap((p) => {
    const placement = placements.get(p.id);
    return placement ? [placement] : [];
  });
  if (
    frame.scene.molecules.length !== unused.length ||
    frame.scene.transitionState ||
    frame.scene.molecules.some((p) => p.bracket === "ts") ||
    frame.scene.reactionArrows?.some((arrow) => arrow.id !== "next-" + frame.id)
  )
    return;
  const matches = new Map<string, Placement>();
  for (const molecule of frame.scene.molecules) {
    const index = unused.findIndex((p) => p.compound === molecule.compound);
    if (index < 0) return;
    matches.set(molecule.id, unused.splice(index, 1)[0]);
  }
  return { frame, matches };
}

export function reactionFrames(reaction: Reaction) {
  const frames = reaction.mechanism?.frames ?? [];
  const first = frames[0];
  const last = frames.at(-1);
  const start =
    first && matchEndpoint(first, reaction.reactants, reaction.scene);
  const end =
    last && last !== start?.frame
      ? matchEndpoint(last, reaction.products, reaction.scene)
      : undefined;
  return {
    start,
    end,
    middle: frames.slice(start ? 1 : 0, end ? -1 : undefined),
  };
}

export function mergeFrameAnnotations(
  scene: Scene,
  prefix: string,
  focus: Focus | undefined,
  endpoints: NonNullable<ReturnType<typeof matchEndpoint>>[],
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
