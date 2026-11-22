<script setup lang="ts">
import { numericCell, observeTableCard } from "./table-card.ts";
import PanelsFigure from "./PanelsFigure.vue";
import LibraryReference from "./library/LibraryReference.vue";
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import MoleculeGroup from "./MoleculeGroup.vue";
import EnergyFigure from "./diagrams/EnergyFigure.vue";
import FlowFigure from "./diagrams/FlowFigure.vue";
import TimelineFigure from "./diagrams/TimelineFigure.vue";
import ImageViewer from "./ImageViewer.vue";
import TermDefinition from "./TermDefinition.vue";
import CitedSource from "./CitedSource.vue";
import type { Citation } from "./citations.ts";
import type { NoteDiagram, NoteMolecules } from "../../shared/notes-index.ts";
import type { GlossaryTerm } from "../../shared/glossary.ts";
const props = withDefaults(
  defineProps<{
    html: string;
    molecules?: NoteMolecules[];
    diagrams?: NoteDiagram[];
    terms?: Record<string, GlossaryTerm>;
    citations?: Record<string, Citation>;
    query?: string;
  }>(),
  {
    molecules: () => [],
    diagrams: () => [],
    terms: () => ({}),
    citations: () => ({}),
    query: "",
  },
);
const emit = defineEmits<{
  matches: [count: number];
  current: [index: number];
  ready: [];
}>();
const body = ref<HTMLElement>();
const ready = ref(false);
const term = ref<GlossaryTerm>();
const termOpen = ref(false);
const imageOpen = ref(false);
const image = ref({ src: "", alt: "" });
const citation = ref<Citation>();
const citationOpen = ref(false);
const matches = ref<HTMLElement[]>([]);
const current = ref(0);
let tables: (() => void)[] = [];

function cardFor(art: HTMLElement, table = false) {
  const card = document.createElement("figure");
  card.className = table ? "figure-card figure-card--table" : "figure-card";
  const area = document.createElement("div");
  area.className = "figure-card-art";
  art.before(card);
  card.append(area);
  area.append(art);
  return card;
}

function formatProseCards(element: HTMLElement) {
  for (const table of element.querySelectorAll(".table-scroll > table")) {
    for (const cell of table.querySelectorAll("tbody td"))
      cell.toggleAttribute("data-numeric", numericCell(cell.textContent ?? ""));
    tables.push(observeTableCard(cardFor(table.parentElement!, true)));
  }
  const imageParagraphs = new Map<HTMLElement, HTMLElement>();
  for (const image of element.querySelectorAll<HTMLElement>(".note-image")) {
    const caption = image.nextElementSibling;
    const paragraph = image.parentElement!;
    image.classList.add("figure-image-open");
    const card = cardFor(image);
    if (caption?.matches(".note-caption")) {
      const label = document.createElement("figcaption");
      label.className = "figure-card-caption";
      label.append(...caption.childNodes);
      caption.remove();
      card.append(label);
    }
    if (paragraph.tagName !== "P") continue;
    if (!imageParagraphs.has(paragraph)) {
      const group = document.createElement("div");
      group.className = "note-image-group";
      paragraph.before(group);
      imageParagraphs.set(paragraph, group);
    }
    imageParagraphs.get(paragraph)!.append(card);
  }
  for (const [paragraph, group] of imageParagraphs) {
    if (group.childElementCount === 1)
      group.replaceWith(group.firstElementChild!);
    if (!paragraph.textContent?.trim() && !paragraph.children.length)
      paragraph.remove();
  }
}
function showMatch(index: number) {
  if (!matches.value.length) return;
  current.value = (index + matches.value.length) % matches.value.length;
  const target = matches.value[current.value];
  target.closest("details")?.setAttribute("open", "");
  target.scrollIntoView({ block: "center" });
  emit("current", current.value + 1);
}
function highlight() {
  const element = body.value;
  if (!element) return;
  const parents = new Set<HTMLElement>();
  for (const mark of element.querySelectorAll("mark[data-match]")) {
    if (mark.parentElement) parents.add(mark.parentElement);
    mark.replaceWith(document.createTextNode(mark.textContent ?? ""));
  }
  // Never normalize the molecule and diagram mounts: Vue owns their text anchors.
  for (const parent of parents) parent.normalize();
  matches.value = [];
  const query = props.query.trim();
  if (query) {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) =>
        node.parentElement?.closest(
          ".katex,svg,.note-molecules,.note-diagram,.request",
        )
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT,
    });
    const nodes: Text[] = [];
    while (walker.nextNode()) {
      if (walker.currentNode instanceof Text) nodes.push(walker.currentNode);
    }
    for (const node of nodes) {
      const text = node.textContent ?? "";
      let pos = 0,
        at = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
      if (at < 0) continue;
      const fragment = document.createDocumentFragment();
      while (at >= 0) {
        fragment.append(document.createTextNode(text.slice(pos, at)));
        const mark = document.createElement("mark");
        mark.dataset.match = "";
        mark.textContent = text.slice(at, at + query.length);
        fragment.append(mark);
        matches.value.push(mark);
        pos = at + query.length;
        at = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase(), pos);
      }
      fragment.append(document.createTextNode(text.slice(pos)));
      node.replaceWith(fragment);
    }
  }
  emit("matches", matches.value.length);
  emit("current", matches.value.length ? 1 : 0);
  current.value = 0;
  if (matches.value.length) showMatch(0);
}
async function render() {
  ready.value = false;
  await nextTick();
  tables.forEach((stop) => stop());
  tables = [];
  if (body.value) {
    body.value.innerHTML = props.html;
    formatProseCards(body.value);
  }
  ready.value = true;
  await nextTick();
  await document.fonts.ready;
  await Promise.all(
    Array.from(body.value?.querySelectorAll("img") ?? [])
      .filter((img) => img.loading !== "lazy" || img.complete)
      .map((img) => img.decode().catch(() => undefined)),
  );
  if (!body.value) return;
  highlight();
  emit("ready");
}
function click(event: MouseEvent) {
  const target = event.target instanceof Element ? event.target : null;
  const button = target?.closest<HTMLElement>("[data-term]");
  if (button) {
    term.value = props.terms[button.dataset.term ?? ""];
    termOpen.value = true;
  }
  const picture = target?.closest<HTMLElement>("[data-image]");
  if (picture) {
    image.value = {
      src: picture.dataset.image ?? "",
      alt: picture.querySelector("img")?.alt ?? "",
    };
    imageOpen.value = true;
  }
  const cite = target?.closest<HTMLElement>("[data-cite]");
  if (cite) {
    citation.value = props.citations[cite.dataset.cite ?? ""];
    citationOpen.value = true;
  }
}
onMounted(render);
watch(() => props.html, render);
watch(
  () => props.query,
  () => {
    void nextTick(highlight);
  },
);
onBeforeUnmount(() => {
  tables.forEach((stop) => stop());
  ready.value = false;
});
defineExpose({ showMatch });
</script>
<template>
  <div ref="body" class="prose compiled-prose" @click="click"></div>
  <template v-if="ready">
    <Teleport v-for="row in molecules" :key="row.id" :to="`#${row.id}`">
      <MoleculeGroup :molecules="row.molecules" />
    </Teleport>
    <Teleport v-for="row in diagrams" :key="row.id" :to="`#${row.id}`">
      <TimelineFigure
        v-if="row.kind === 'timeline'"
        :timeline="row.timeline"
        :caption="row.caption"
      />
      <FlowFigure
        v-else-if="row.kind === 'flow'"
        :flow="row.flow"
        :caption="row.caption"
      />
      <EnergyFigure
        v-else-if="row.kind === 'energy'"
        :energy="row.energy"
        :caption="row.caption"
      />
      <PanelsFigure v-else-if="row.kind === 'panels'" :panels="row.panels" />
      <LibraryReference v-else :reference="row.reference" />
    </Teleport>
  </template>
  <TermDefinition v-model:open="termOpen" :term="term" />
  <ImageViewer
    v-model:open="imageOpen"
    :src="image.src"
    :alt="image.alt"
    :title="image.alt"
  />
  <CitedSource v-model:open="citationOpen" :citation="citation" />
</template>
<style scoped>
.compiled-prose {
  overflow-wrap: anywhere;
}
.compiled-prose :deep(.term) {
  display: inline;
  padding: 0;
  border: 0;
  border-bottom: 1px dotted var(--accent);
  background: none;
  color: inherit;
  font: inherit;
  cursor: help;
}
.compiled-prose :deep(.term:hover) {
  color: var(--accent);
}
.compiled-prose :deep(mark) {
  color: var(--ink);
  background: var(--evidence-soft);
}
.compiled-prose :deep([id]) {
  scroll-margin-top: var(--space-8);
}
.compiled-prose :deep(.note-callout) {
  margin-block: var(--space-5);
}
.compiled-prose :deep(.note-callout .callout-title) {
  font-weight: 500;
  letter-spacing: 0;
  color: var(--ink);
}
.compiled-prose :deep(.note-callout .callout-kind) {
  margin-right: 0.6em;
  color: var(--accent);
  letter-spacing: 0.04em;
}
.compiled-prose :deep(.note-callout.callout--caution .callout-kind) {
  color: var(--danger);
}
.compiled-prose :deep(.note-callout p) {
  margin: 0;
}
.compiled-prose :deep(.note-callout p + p),
.compiled-prose :deep(.note-callout p + ul),
.compiled-prose :deep(.note-callout ul + p) {
  margin-top: var(--space-2);
}
.compiled-prose :deep(.note-callout ul) {
  margin: var(--space-2) 0 0;
  padding-left: 1.3em;
}
</style>
