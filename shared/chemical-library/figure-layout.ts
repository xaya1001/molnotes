import type { Figure, FigureGraph, GraphArrow, Scene } from "./types.ts";

export type GraphPanel = {
  id: string;
  title: string;
  scene: Scene;
};

export function graphPanels(
  graph: FigureGraph,
  items?: string[],
): GraphPanel[] {
  const grouped = new Set(
    Object.values(graph.groups ?? {}).flatMap((group) =>
      group.scene ? group.items : [],
    ),
  );
  const available = { ...graph.states, ...graph.groups };
  const { ordered } = statePath(graph);
  const ids = items ?? ordered.filter((id) => !grouped.has(id));
  return ids.flatMap((id) => {
    const item = available[id];
    return item?.scene
      ? [{ id, title: item.title ?? id, scene: item.scene }]
      : [];
  });
}

export function panelArrows(graph: FigureGraph, panels: GraphPanel[]) {
  const ids = new Set(panels.map(({ id }) => id));
  return Object.entries(graph.arrows).filter(
    ([, arrow]) =>
      arrow.from.every(({ state }) => ids.has(state)) &&
      arrow.to.every(({ state }) => ids.has(state)),
  );
}

export function graphView(graph: FigureGraph, item: string) {
  const [arrow, component, ...rest] = item.split("/");
  if (component !== "via") return { graph, item };
  const via = graph.arrows[arrow]?.via;
  if (!via) throw new Error(`Unknown subgraph ${arrow}`);
  return graphView(via, rest.join("/"));
}

export function drawnArrows(graph: FigureGraph) {
  return Object.entries(graph.arrows).filter(
    (
      entry,
    ): entry is [
      string,
      GraphArrow & { drawing: NonNullable<GraphArrow["drawing"]> },
    ] => entry[1].drawing !== undefined,
  );
}

export function appearances(items: GraphArrow["from"]) {
  return items.flatMap(({ appearance }) => (appearance ? [appearance] : []));
}

function statePath(graph: FigureGraph) {
  const incoming = new Set(
    Object.values(graph.arrows).flatMap((edge) =>
      edge.to.map(({ state }) => state),
    ),
  );
  const outgoing = new Map(
    Object.entries(graph.arrows).flatMap(([id, edge]) =>
      edge.from.map(({ state }) => [state, [id, edge]] as const),
    ),
  );
  const visited = new Set<string>();
  const ordered: string[] = [];
  const append = (start: string) => {
    let id: string | undefined = start;
    while (id !== undefined && !visited.has(id)) {
      visited.add(id);
      ordered.push(id);
      id = outgoing.get(id)?.[1].to[0].state;
    }
  };
  const items = [
    ...Object.keys(graph.states),
    ...Object.keys(graph.groups ?? {}),
  ];
  for (const id of items) if (!incoming.has(id)) append(id);
  for (const id of items) append(id);
  return { ordered, outgoing };
}

export function graphReferenceScenes(figure: Figure, viewId?: string) {
  const select = viewId ? figure.views[viewId].items : undefined;
  const target =
    select?.length === 1 ? graphView(figure.graph, select[0]) : undefined;
  const graph = target?.graph ?? figure.graph;
  if (graph.layout?.panel && (!viewId || viewId === "overview"))
    return [{ scene: graph.layout.panel, prefix: "" }];
  if (!viewId) {
    const drawn = drawnArrows(graph);
    if (drawn.length)
      return drawn.flatMap(([id, arrow]) => [
        { scene: arrow.drawing.scene, prefix: id + "/" },
        ...(arrow.via
          ? graphPanels(arrow.via).map((panel) => ({
              scene: panel.scene,
              prefix: id + "/" + panel.id + "/",
            }))
          : []),
      ]);
  }
  const panels = graphPanels(graph, target ? [target.item] : select);
  return panels.map(({ id, scene }) => ({
    scene,
    prefix: panels.length === 1 ? "" : id + "/",
  }));
}

export function graphScenes(graph: FigureGraph) {
  const scenes = [
    ...Object.values(graph.states).flatMap(({ scene }) =>
      scene ? [scene] : [],
    ),
    ...Object.values(graph.groups ?? {}).flatMap(({ scene }) =>
      scene ? [scene] : [],
    ),
    ...(graph.layout?.panel ? [graph.layout.panel] : []),
  ];
  for (const arrow of Object.values(graph.arrows)) {
    if (arrow.drawing) scenes.push(arrow.drawing.scene);
    if (arrow.via) scenes.push(...graphScenes(arrow.via));
  }
  return scenes;
}
