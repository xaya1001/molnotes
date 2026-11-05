import type { TopicContent } from "../src/ui/topic/content.ts";
import type { TopicBlock } from "../src/ui/topic/blocks.ts";
import type { MoleculeData } from "../src/ui/chemistry/types.ts";
import {
  validateSynthesisRoutes,
  validateSubstrateScope,
} from "./reaction-scheme.ts";
import { validateProcess } from "./process.ts";
import { defineFlow } from "../src/ui/diagrams/flow.ts";
import { defineTimeline } from "../src/ui/diagrams/model.ts";
import { resolveData, validateMechanismFrames } from "./topic-blocks.ts";
import {
  validateFigureReference,
  validateFigureInstance,
} from "./chemical-library/contract.ts";
import type { Library } from "./chemical-library/types.ts";
export interface PreviewFigure {
  where: string;
  kind:
    | "timeline"
    | "flow"
    | "process"
    | "molecule"
    | "route"
    | "substrate-scope"
    | "library"
    | "mechanism";
  value: unknown;
  caption: string;
}
const define = {
  timeline: defineTimeline,
  flow: defineFlow,
  process: (value: unknown) => {
    validateProcess(value, "process");
    return value;
  },
};
/** The figures of a topic's blocks, tabs included. */
// `topic` is a content.json the preview reads as written; it is not validated.
export function topicFigures(
  topic: TopicContent,
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
      if (block.type === "figure-ref" || block.type === "mechanism") {
        try {
          if (block.type === "figure-ref") {
            const { type, ...reference } = block;
            validateFigureReference(reference, at);
            const entry = library[reference.ref];
            const references =
              entry?.kind === "mechanism" && !reference.frame
                ? entry.frames.map((frame) => ({
                    ...reference,
                    frame: frame.id,
                  }))
                : [reference];
            for (const ref of references) {
              validateFigureInstance(library, ref);
              figures.push({
                where: at,
                kind: "library",
                value: ref,
                caption: reference.caption ?? "",
              });
            }
          } else {
            const frames = resolveData(block.frames, topic.data, at);
            validateMechanismFrames(frames, at);
            frames.forEach((frame, index) =>
              figures.push({
                where: `${at} frame ${index + 1}`,
                kind: "mechanism",
                value: [frame],
                caption: block.title ?? "",
              }),
            );
          }
        } catch (error) {
          errors.push(`${at}: ${(error as Error).message}`);
        }
      }
      if (
        block.type === "timeline" ||
        block.type === "flow" ||
        block.type === "process"
      ) {
        try {
          const kind = block.type;
          const value = resolveData(
            block.type === "timeline"
              ? block.timeline
              : block.type === "flow"
                ? block.flow
                : block.process,
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
      if (block.type === "route" || block.type === "substrate-scope") {
        const value = resolveData(
          block.type === "route" ? block.routes : block.scope,
          topic.data,
          at,
        );
        if (block.type === "route") validateSynthesisRoutes(value, at);
        else validateSubstrateScope(value, at);
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
