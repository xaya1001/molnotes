import type { TopicBlock } from "../src/ui/topic/blocks.ts";
import type { MoleculeData } from "../src/ui/chemistry/types.ts";
import { validateSubstrateScope } from "./reaction-scheme.ts";
import { definePanels, panelReferences } from "./panels.ts";
import { defineFlow } from "../src/ui/diagrams/flow.ts";
import { defineTimeline } from "../src/ui/diagrams/model.ts";
import { resolveData } from "./topic-blocks.ts";
import {
  validateFigureReference,
  validateFigureInstance,
} from "./chemical-library/contract.ts";
import type { Library } from "./chemical-library/types.ts";
import type { Note } from "./notes-index.ts";
import type { GlossaryTerm } from "./glossary.ts";
export interface ResourceRequest {
  file: string;
  line: number;
  kind: string;
  caption: string;
  skill: string;
  fields: Record<string, unknown>;
}
export interface RequestIssue {
  line: number;
  path: string;
  message: string;
}
export interface RequestDisplay {
  label: string;
  icon: string;
  meta?: string;
  filename?: boolean;
  prompt?: string;
  yaml?: boolean;
  states?: { id: string; title: string; smiles: string; note?: string }[];
  chart?: {
    columns: string[];
    rows: (string | number)[][];
    axes: { label: string; text: string }[];
    point: string;
  };
}
export interface PreviewRequest extends ResourceRequest {
  id: string;
  source: string;
  errors: RequestIssue[];
  display: RequestDisplay;
}
export interface PreviewNote {
  note: Note;
  requests: PreviewRequest[];
  terms: Record<string, GlossaryTerm>;
}
export interface PreviewFigure {
  where: string;
  title?: string;
  kind:
    | "timeline"
    | "note"
    | "request"
    | "flow"
    | "panels"
    | "molecule"
    | "substrate-scope"
    | "library";
  value: unknown;
  caption: string;
}
const define = {
  timeline: defineTimeline,
  flow: defineFlow,
};
/** The figures of a topic's blocks, tabs included. */
// `topic` is a content.json the preview reads as written; it is not validated.
export function topicFigures(
  topic: {
    chapters: { title: string; blocks: TopicBlock[] }[];
    data?: Record<string, unknown>;
  },
  file: string,
  errors: string[],
  library: Library,
) {
  const figures: PreviewFigure[] = [];
  const visit = (blocks: TopicBlock[], where: string) =>
    blocks.forEach((block, i) => {
      const at = `${where} 第 ${i + 1} 块`;
      if (block.type === "tabs")
        block.items.forEach((item) =>
          visit(item.blocks, `${at}「${item.label}」`),
        );
      if (block.type === "panels") {
        try {
          const { type, id, ...input } = block;
          const panels = definePanels(input);
          panelReferences(panels).forEach((reference) =>
            validateFigureInstance(library, reference),
          );
          figures.push({
            where: at,
            kind: "panels",
            value: panels,
            caption: panels.caption ?? "",
          });
        } catch (error) {
          errors.push(`${at}: ${(error as Error).message}`);
        }
      }
      if (block.type === "figure-ref") {
        try {
          const { type, ...reference } = block;
          validateFigureReference(reference, at);
          validateFigureInstance(library, reference);
          const entry = library[reference.ref];
          const view =
            reference.frame && entry?.kind === "figure"
              ? reference.frame
              : undefined;
          figures.push({
            where: view ? `${at} [${view}]` : at,
            kind: "library",
            value: reference,
            caption: reference.caption ?? "",
          });
        } catch (error) {
          errors.push(`${at}: ${(error as Error).message}`);
        }
      }
      if (block.type === "timeline" || block.type === "flow") {
        try {
          const kind = block.type;
          const value = resolveData(
            block.type === "timeline" ? block.timeline : block.flow,
            topic.data,
            at,
          );
          define[kind](value);
          figures.push({
            where: at,
            kind,
            value,
            caption: "caption" in block ? (block.caption ?? "") : "",
          });
        } catch (error) {
          errors.push(`${at}: ${(error as Error).message}`);
        }
      }
      if (block.type === "substrate-scope") {
        const value = resolveData(block.scope, topic.data, at);
        validateSubstrateScope(value, at);
        figures.push({ where: at, kind: block.type, value, caption: "" });
      }
      if (block.type === "molecule")
        figures.push({
          where: at,
          kind: "molecule",
          value: [{ smiles: block.smiles, caption: block.name }],
          caption: "",
        });
      if (block.type === "molecules")
        figures.push({
          where: at,
          kind: "molecule",
          value: resolveData<MoleculeData[]>(block.items, topic.data, at).map(
            (m) => ({
              smiles: m.smiles,
              caption: m.name,
            }),
          ),
          caption: "",
        });
    });
  topic.chapters.forEach((chapter, c: number) =>
    visit(chapter.blocks ?? [], `${file} 第 ${c + 1} 章「${chapter.title}」`),
  );
  return figures;
}
