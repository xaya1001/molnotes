import { validateFigureReference } from "./chemical-library/contract.ts";
import type { FigureReference } from "./chemical-library/types.ts";
import {
  defineFlow,
  flowText,
  type FlowInput,
} from "../src/ui/diagrams/flow.ts";
import { only, list, text, fail } from "../src/ui/diagrams/model.ts";

export type PanelItem = { title: string; text: string } & (
  | (FigureReference & { flow?: never })
  | { flow: FlowInput; ref?: never; frame?: never }
);
export interface Panels {
  mode: "steps" | "compare";
  caption?: string;
  items: PanelItem[];
}
export function definePanels(value: unknown): Panels {
  const input = only(value, ["mode", "caption", "items"], "panels");
  if (input.mode !== "steps" && input.mode !== "compare")
    fail("panels mode 只能是 steps 或 compare");
  const items = list(input.items, "panels items");
  if (items.length < 2)
    fail(`panels 只有 ${items.length} 项：一张图用 figure-ref`);
  if (items.length > 12) fail("panels 最多 12 项");
  if (input.caption !== undefined) text(input.caption, "panels caption");
  items.forEach((value, index) => {
    const where = `panels 第 ${index + 1} 项`;
    const item = only(
      value,
      ["title", "text", "ref", "variant", "frame", "numbers", "focus", "flow"],
      where,
    );
    text(item.title, `${where} title`);
    if (typeof item.text !== "string") fail(`${where} text 必须是文字`);
    if ((item.ref === undefined) === (item.flow === undefined))
      fail(`${where} 缺少图：写 ref 或 flow 之一`);
    const { title, text: explanation, flow, ...reference } = item;
    if (flow !== undefined) {
      if (Object.keys(reference).length)
        fail(`${where} flow 不能带图库引用字段`);
      if (flow && typeof flow === "object" && "steps" in flow)
        fail(`${where} flow 不能写 steps`);
      defineFlow(flow);
    } else validateFigureReference(reference, where);
  });
  return input as unknown as Panels;
}
export function panelsText(panels: Panels): string[] {
  return [
    panels.caption ?? "",
    ...panels.items.flatMap((item) => [
      item.title,
      item.text,
      ...(item.flow ? flowText(defineFlow(item.flow)) : []),
    ]),
  ];
}
export function panelGroups(panels: Panels) {
  const groups: { item: PanelItem; indices: number[] }[] = [];
  panels.items.forEach((item, index) => {
    const last = groups.at(-1);
    if (
      panels.mode === "steps" &&
      last &&
      item.ref &&
      last.item.ref === item.ref &&
      last.item.frame === item.frame
    )
      last.indices.push(index);
    else groups.push({ item, indices: [index] });
  });
  return groups;
}
export function panelColumns(count: number, width: number, minimum: number) {
  for (const columns of count === 4 ? [2] : [3, 2])
    if (columns <= count && (width - (columns - 1) * 16) / columns >= minimum)
      return columns;
  return 1;
}

export function panelReference(item: PanelItem): FigureReference | undefined {
  if (!item.ref) return undefined;
  const { title, text, flow, ...reference } = item;
  return reference;
}
export function panelReferences(panels: Panels): FigureReference[] {
  return panels.items.flatMap((item) => {
    const reference = panelReference(item);
    return reference ? [reference] : [];
  });
}
