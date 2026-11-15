<script setup lang="ts">
import {
  validateSubstrateScope,
  type SubstrateScope as ScopeData,
} from "../../../shared/reaction-scheme.ts";
import SubstrateScope from "../../ui/SubstrateScope.vue";
import type { NoteMolecules } from "../../../shared/notes-index.ts";
import { nextTick, onMounted, ref } from "vue";
import {
  definePanels,
  panelReferences,
  type Panels,
} from "../../../shared/panels.ts";
import PanelsFigure from "../../ui/PanelsFigure.vue";
import MoleculeView from "../../ui/MoleculeView.vue";
import FlowFigure from "../../ui/diagrams/FlowFigure.vue";
import TimelineFigure from "../../ui/diagrams/TimelineFigure.vue";
import { figureWarnings } from "../../ui/diagrams/check.ts";
import { defineFlow, type Flow } from "../../ui/diagrams/flow.ts";
import { defineTimeline, type Timeline } from "../../ui/diagrams/model.ts";
import type { PreviewFigure as Injected } from "../../../shared/content-preview.ts";
import type {
  LibrarySnapshot,
  FigureReference,
} from "../../../shared/chemical-library/types.ts";
import { validateFigureReference } from "../../../shared/chemical-library/contract.ts";
import { figureViewKey } from "../../../shared/chemical-library/views.ts";
import LibraryFigure from "../../ui/library/LibraryFigure.vue";
import CompiledProse from "../../ui/CompiledProse.vue";
import type {
  PreviewNote,
  PreviewRequest,
} from "../../../shared/content-preview.ts";
import RequestPlaceholder from "../RequestPlaceholder.vue";

// The content preview command injects the figures of one unit and reads the
// warnings back; the page is not linked from the showcase.
type Shown =
  | { where: string; kind: "request"; request: PreviewRequest; caption: string }
  | { where: string; kind: "note"; preview: PreviewNote; caption: string }
  | {
      where: string;
      kind: "library";
      reference: FigureReference;
      caption: string;
      title?: string;
    }
  | {
      where: string;
      kind: "substrate-scope";
      scope: ScopeData;
      caption: string;
    }
  | { where: string; kind: "timeline"; timeline: Timeline; caption: string }
  | { where: string; kind: "flow"; flow: Flow; caption: string }
  | { where: string; kind: "panels"; panels: Panels; caption: string }
  | {
      where: string;
      kind: "molecule";
      molecules: NoteMolecules["molecules"];
      caption: string;
    };
declare global {
  interface Window {
    __previewFigures?: Injected[];
    __previewLibrary?: LibrarySnapshot;
    __previewResult?: {
      where: string;
      warnings: string[];
      errors?: string[];
    }[];
  }
}

function schemeFigure(f: Injected): Shown {
  validateSubstrateScope(f.value, f.where);
  return { ...f, kind: "substrate-scope", scope: f.value };
}
function chemicalFigure(f: Injected): Shown {
  validateFigureReference(f.value, f.where);
  return { ...f, kind: "library", reference: f.value };
}
const shown: Shown[] = (window.__previewFigures ?? []).map((f) =>
  f.kind === "request"
    ? { ...f, kind: "request", request: f.value as PreviewRequest }
    : f.kind === "note"
      ? { ...f, kind: "note", preview: f.value as PreviewNote }
      : f.kind === "library"
        ? chemicalFigure(f)
        : f.kind === "substrate-scope"
          ? schemeFigure(f)
          : f.kind === "timeline"
            ? { ...f, kind: "timeline", timeline: defineTimeline(f.value) }
            : f.kind === "flow"
              ? { ...f, kind: "flow", flow: defineFlow(f.value) }
              : f.kind === "panels"
                ? { ...f, kind: "panels", panels: definePanels(f.value) }
                : {
                    ...f,
                    kind: "molecule",
                    molecules: f.value as NoteMolecules["molecules"],
                  },
);
const figures = ref<HTMLElement[]>([]);
const library = window.__previewLibrary ?? { entries: {}, uses: {} };
function figureDiagnostics(figure: Shown) {
  const references =
    figure.kind === "library"
      ? [figure.reference]
      : figure.kind === "panels"
        ? panelReferences(figure.panels)
        : figure.kind === "note"
          ? (figure.preview.note.diagrams ?? []).flatMap((diagram) =>
              diagram.kind === "library"
                ? [diagram.reference]
                : diagram.kind === "panels"
                  ? panelReferences(diagram.panels)
                  : [],
            )
          : [];
  return references.flatMap(
    (reference) =>
      library.renders?.[figureViewKey(reference)]?.diagnostics ?? [],
  );
}
const readyNotes = ref(0);

const settle = () =>
  new Promise((done) =>
    requestAnimationFrame(() => requestAnimationFrame(done)),
  );
onMounted(async () => {
  await nextTick();
  for (const image of document.querySelectorAll<HTMLImageElement>(
    ".preview-figure img",
  ))
    image.loading = "eager";
  // Structures draw once RDKit has loaded; timelines measure their labels first.
  const deadline = Date.now() + 30_000;
  while (
    Date.now() < deadline &&
    (readyNotes.value < shown.filter((f) => f.kind === "note").length ||
      document.querySelector(".molecule [role='status']") ||
      [...document.querySelectorAll(".library-canvas")].some(
        (node) =>
          !node.querySelector("svg") &&
          !node.closest("figure")?.querySelector('[role="alert"]'),
      ) ||
      [
        ...document.querySelectorAll<HTMLImageElement>(".preview-figure img"),
      ].some((img) => {
        img.loading = "eager";
        return !img.complete;
      }))
  )
    await new Promise((done) => setTimeout(done, 100));
  for (let i = 0; i < 3; i++) await settle();
  window.__previewResult = shown.map((figure, i) => {
    const host = figures.value[i];
    const errors = [...host.querySelectorAll('[role="alert"]')].map(
      (node) => node.textContent?.trim() ?? "Render failed",
    );
    const found = figureDiagnostics(figure);
    errors.push(...found.map((d) => `${d.code}: ${d.elements.join(", ")}`));
    if (figure.kind === "request")
      return {
        where: figure.where,
        warnings: [],
        errors: figure.request.errors.map(
          (error) =>
            `${figure.request.file}:${error.line}: ${error.path}: ${error.message}`,
        ),
      };
    if (figure.kind === "note") {
      for (const img of host.querySelectorAll<HTMLImageElement>("img"))
        if (!img.complete || !img.naturalWidth)
          errors.push("Image did not load");
      return {
        where: figure.where,
        errors: [
          ...errors,
          ...figure.preview.requests.flatMap((request) =>
            request.errors.map(
              (error) =>
                `${request.file}:${error.line}: ${error.path}: ${error.message}`,
            ),
          ),
        ],
        warnings: [
          ...found.map((d) => `${d.code}: ${d.elements.join(", ")}`),
          ...[
            ...host.querySelectorAll<HTMLElement>(
              "figure.timeline, figure.flow, figure.energy, figure.molecule, .panels-figure",
            ),
          ].flatMap(figureWarnings),
        ],
      };
    }
    if (figure.kind === "library") {
      const canvas = host.querySelector(".library-canvas");
      if (canvas && !canvas.querySelector("svg"))
        errors.push("Figure did not finish rendering");
      for (const img of host.querySelectorAll<HTMLImageElement>("img"))
        if (!img.complete || !img.naturalWidth)
          errors.push("Image did not load");
      return {
        where: figure.where,
        warnings: [...found.map((d) => `${d.code}: ${d.elements.join(", ")}`)],
        errors,
      };
    }
    const root = figures.value[i]?.querySelector<HTMLElement>(
      ".panels-figure, .substrate-scope, figure.timeline, figure.flow, figure.energy, figure.molecule",
    );
    return {
      where: figure.where,
      ...(errors.length ? { errors } : {}),
      warnings: root
        ? [
            ...found.map((d) => `${d.code}: ${d.elements.join(", ")}`),
            ...figureWarnings(root),
            ...[
              ...figures.value[i].querySelectorAll<HTMLElement>(
                "[data-alignment-warning]",
              ),
            ].flatMap((node) =>
              (node.dataset.alignmentWarning ?? "").split("\n").filter(Boolean),
            ),
            ...[
              ...figures.value[i].querySelectorAll<HTMLElement>(
                "figure.molecule",
              ),
            ]
              .slice(1)
              .flatMap(figureWarnings),
          ]
        : ["没有渲染出图"],
    };
  });
});
</script>

<template>
  <article class="page-reading">
    <div class="prose">
      <section
        v-for="(figure, i) in shown"
        :key="i"
        ref="figures"
        :data-preview="i"
        class="preview-figure"
      >
        <RequestPlaceholder
          v-if="figure.kind === 'request'"
          :request="figure.request"
        />
        <template v-else-if="figure.kind === 'note'">
          <h1>{{ figure.preview.note.title }}</h1>
          <CompiledProse
            :html="figure.preview.note.html"
            :molecules="figure.preview.note.molecules"
            :diagrams="figure.preview.note.diagrams"
            :citations="figure.preview.note.citations"
            :terms="figure.preview.terms"
            @ready="readyNotes++"
          />
          <template v-if="readyNotes">
            <Teleport
              v-for="request in figure.preview.requests"
              :key="request.id"
              :to="`#${request.id}`"
            >
              <RequestPlaceholder :request="request" />
            </Teleport>
          </template>
        </template>
        <template v-else>
          <h3 v-if="figure.kind === 'library' && figure.title">
            {{ figure.title }}
          </h3>
          <LibraryFigure
            v-if="figure.kind === 'library'"
            :library="library"
            :reference="figure.reference"
          />
          <TimelineFigure
            v-else-if="figure.kind === 'timeline'"
            :timeline="figure.timeline"
            :caption="figure.caption"
          />
          <FlowFigure
            v-else-if="figure.kind === 'flow'"
            :flow="figure.flow"
            :caption="figure.caption"
          />
          <PanelsFigure
            v-else-if="figure.kind === 'panels'"
            :panels="figure.panels"
            :library="library"
          />
          <SubstrateScope
            v-else-if="figure.kind === 'substrate-scope'"
            :scope="figure.scope"
          />
          <div v-else class="preview-molecules">
            <MoleculeView
              v-for="(m, j) in figure.molecules"
              :key="j"
              :smiles="m.smiles"
              :abbreviations="m.abbreviations"
              :name="m.caption"
            />
          </div>
        </template>
      </section>
    </div>
  </article>
</template>

<style scoped>
.preview-figure {
  padding: var(--space-4) 0;
}
.preview-molecules {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
}
.preview-molecules > :deep(figure) {
  flex: 1 1 14rem;
  min-width: 0;
}
</style>
