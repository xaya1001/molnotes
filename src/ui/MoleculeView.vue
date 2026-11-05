<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from "vue";
import { loadChemistry } from "./chemistry/rdkit.ts";
import { type MoleculeAbbreviation } from "../../shared/molecule-abbreviations.ts";
import {
  moleculeScreenScale,
  electronArrowLineWidth,
} from "./chemistry/drawing.ts";
import type { ElectronArrow, StructureAnchor } from "./chemistry/types.ts";
import { drawMolecule } from "./chemistry/depiction.ts";
const props = withDefaults(
  defineProps<{
    smiles: string;
    name: string;
    abbreviations?: readonly MoleculeAbbreviation[];
    selectable?: "atoms" | "bonds";
    /** Indices to pick, or, when nothing is selectable, a reader's earlier choice to compare. */
    selected?: readonly number[];
    /** What `selected` indexes when nothing is selectable. */
    selectedKind?: "atoms" | "bonds";
    highlightAtoms?: readonly number[];
    highlightBonds?: readonly number[];
    labels?: Record<number, string>;
    arrows?: readonly ElectronArrow[];
    disabled?: boolean;
  }>(),
  {
    abbreviations: () => [],
    selected: () => [],
    selectedKind: "atoms",
    highlightAtoms: () => [],
    highlightBonds: () => [],
    labels: () => ({}),
    arrows: () => [],
  },
);
const emit = defineEmits<{ "update:selected": [value: number[]] }>();
type Point = { x: number; y: number };
const svg = ref("");
const structure = ref<SVGSVGElement>();
const bounds = ref({ x: 0, y: 0, width: 600, height: 360 });
// Crop without changing the shared screen scale; max-width shrinks wide structures.
watch(
  [
    svg,
    () => props.selected,
    () => props.highlightAtoms,
    () => props.highlightBonds,
    () => props.labels,
    () => props.arrows,
    () => props.selectable,
  ],
  async () => {
    await nextTick();
    if (!structure.value) return;
    const box = structure.value.getBBox();
    const padding = 12;
    bounds.value = {
      x: box.x - padding,
      y: box.y - padding,
      width: box.width + padding * 2,
      height: box.height + padding * 2,
    };
  },
  { deep: true, flush: "post" },
);
const atoms = ref<Point[]>([]);
const bonds = ref<[number, number][]>([]);
const foldedAtoms = ref(new Set<number>());
const error = ref("");
const retry = ref(0);
const marker = useId();
watch(
  [() => props.smiles, () => props.abbreviations, retry],
  async (_, __, cleanup) => {
    let active = true;
    cleanup(() => {
      active = false;
    });
    svg.value = "";
    atoms.value = [];
    bonds.value = [];
    error.value = "";
    try {
      const toolkit = await loadChemistry();
      if (!active) return;
      const depiction = drawMolecule(
        toolkit,
        props.smiles,
        props.abbreviations,
      );
      foldedAtoms.value = depiction.folded;
      atoms.value = depiction.atoms;
      bonds.value = depiction.bonds;
      svg.value = depiction.markup;
    } catch (reason) {
      if (active)
        error.value =
          reason instanceof Error ? reason.message : "RDKit 加载或计算失败";
    }
  },
  { immediate: true },
);
function anchor(at: StructureAnchor): Point {
  if ("atom" in at) {
    const point = atoms.value[at.atom];
    if (!point) throw new Error(`Unknown atom index: ${at.atom}`);
    return point;
  }
  const edge = bonds.value[at.bond];
  if (!edge) throw new Error(`Unknown bond index: ${at.bond}`);
  const [a, b] = edge.map((i) => atoms.value[i]);
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
const arrows = computed(() =>
  !svg.value
    ? []
    : props.arrows.map((arrow) => {
        const a = anchor(arrow.from),
          b = anchor(arrow.to),
          bend = arrow.bend ?? 0.45;
        const x = (a.x + b.x) / 2 - (b.y - a.y) * bend;
        const y = (a.y + b.y) / 2 + (b.x - a.x) * bend;
        return {
          path: `M ${a.x} ${a.y} Q ${x} ${y} ${b.x} ${b.y}`,
          electrons: arrow.electrons,
        };
      }),
);
function toggle(index: number) {
  if (props.disabled) return;
  emit(
    "update:selected",
    props.selected.includes(index)
      ? props.selected.filter((i) => i !== index)
      : [...props.selected, index],
  );
}
</script>
<template>
  <figure class="molecule" :aria-label="name">
    <div v-if="error" role="alert" class="callout callout--caution">
      <p>{{ error }}</p>
      <code>{{ smiles }}</code>
      <button class="button" @click="retry++">重试结构加载</button>
    </div>
    <p v-else-if="!svg" role="status">正在绘制 {{ name }}…</p>
    <svg
      v-else
      class="structure"
      ref="structure"
      :viewBox="`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`"
      :style="{ width: `${bounds.width * moleculeScreenScale}px` }"
      :role="selectable ? 'group' : 'img'"
      :aria-label="`${name}二维结构`"
    >
      <g aria-hidden="true" v-html="svg" />
      <defs>
        <marker
          :id="`${marker}-2`"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 9 5 L 0 10" class="arrow-head" />
        </marker>
        <marker
          :id="`${marker}-1`"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 9 5" class="arrow-head" />
        </marker>
      </defs>
      <g v-for="(bond, i) in bonds" :key="`b${i}`">
        <line
          v-if="
            !foldedAtoms.has(bond[0]) &&
            !foldedAtoms.has(bond[1]) &&
            (selectable === 'bonds' || highlightBonds.includes(i))
          "
          :x1="atoms[bond[0]].x"
          :y1="atoms[bond[0]].y"
          :x2="atoms[bond[1]].x"
          :y2="atoms[bond[1]].y"
          class="bond-target"
          :class="{
            picked: selectable === 'bonds' && selected.includes(i),
            highlighted: highlightBonds.includes(i),
            interactive: selectable === 'bonds',
          }"
          :role="selectable === 'bonds' ? 'button' : undefined"
          :tabindex="selectable === 'bonds' && !disabled ? 0 : undefined"
          :aria-label="`键 ${i}（原子 ${bond[0]}–${bond[1]}）`"
          :aria-pressed="
            selectable === 'bonds' ? selected.includes(i) : undefined
          "
          :aria-disabled="disabled || undefined"
          @click="selectable === 'bonds' && toggle(i)"
          @keydown.enter.prevent="selectable === 'bonds' && toggle(i)"
          @keydown.space.prevent="selectable === 'bonds' && toggle(i)"
        />
        <line
          v-if="
            !foldedAtoms.has(bond[0]) &&
            !foldedAtoms.has(bond[1]) &&
            !selectable &&
            selectedKind === 'bonds' &&
            selected.includes(i)
          "
          :x1="atoms[bond[0]].x"
          :y1="atoms[bond[0]].y"
          :x2="atoms[bond[1]].x"
          :y2="atoms[bond[1]].y"
          class="comparison-choice comparison-bond"
        >
          <title>你的选择</title>
        </line>
      </g>
      <g v-for="(atom, i) in atoms" :key="i">
        <circle
          v-if="
            !foldedAtoms.has(i) &&
            (selectable === 'atoms' || highlightAtoms.includes(i))
          "
          :cx="atom.x"
          :cy="atom.y"
          :r="12 / moleculeScreenScale"
          class="atom-target"
          :class="{
            picked: selectable === 'atoms' && selected.includes(i),
            highlighted: highlightAtoms.includes(i),
            interactive: selectable === 'atoms',
          }"
          :role="selectable === 'atoms' ? 'button' : undefined"
          :tabindex="selectable === 'atoms' && !disabled ? 0 : undefined"
          :aria-label="`原子 ${i}`"
          :aria-pressed="
            selectable === 'atoms' ? selected.includes(i) : undefined
          "
          :aria-disabled="disabled || undefined"
          @click="selectable === 'atoms' && toggle(i)"
          @keydown.enter.prevent="selectable === 'atoms' && toggle(i)"
          @keydown.space.prevent="selectable === 'atoms' && toggle(i)"
        />
        <circle
          v-if="
            !foldedAtoms.has(i) &&
            !selectable &&
            selectedKind === 'atoms' &&
            selected.includes(i)
          "
          :cx="atom.x"
          :cy="atom.y"
          :r="17 / moleculeScreenScale"
          class="comparison-choice"
        >
          <title>你的选择</title>
        </circle>
        <text
          v-if="!foldedAtoms.has(i) && labels[i]"
          :x="atom.x"
          :y="atom.y - 18"
          class="atom-label"
        >
          {{ labels[i] }}
        </text>
      </g>
      <path
        v-for="(arrow, i) in arrows"
        :key="`arrow${i}`"
        :d="arrow.path"
        class="electron-arrow"
        :style="{ strokeWidth: electronArrowLineWidth }"
        :marker-end="`url(#${marker}-${arrow.electrons})`"
      >
        <title>{{ arrow.electrons === 2 ? "电子对" : "单电子" }}转移</title>
      </path>
    </svg>
    <figcaption>
      <slot name="caption">{{ name }}</slot>
    </figcaption>
    <p v-if="selectable" class="selection" aria-live="polite">
      {{
        selected.length
          ? `已选 ${selected.length} 个${selectable === "atoms" ? "原子" : "键"}`
          : `尚未选择${selectable === "atoms" ? "原子" : "键"}`
      }}
    </p>
  </figure>
</template>
<style scoped>
.molecule {
  margin: 0;
  min-width: 0;
}
.structure {
  display: block;
  max-width: 100%;
  height: auto;
  margin-inline: auto;
  background: var(--surface);
}
.atom-target {
  fill: transparent;
  stroke: transparent;
  stroke-width: 3;
}
.bond-target {
  stroke: transparent;
  stroke-width: 12;
}
.interactive {
  cursor: pointer;
  pointer-events: all;
}
.atom-target.picked,
.atom-target.highlighted {
  stroke: var(--accent);
  fill: var(--accent-soft);
  fill-opacity: 0.5;
}
.comparison-choice {
  fill: none;
  stroke: var(--evidence);
  stroke-width: 3;
  stroke-dasharray: 5 3;
  pointer-events: none;
}
.comparison-bond {
  stroke-width: 14;
  stroke-linecap: round;
  stroke-dasharray: 6 4;
}
.bond-target.picked,
.bond-target.highlighted {
  stroke: var(--accent);
  stroke-opacity: 0.45;
}
.interactive:hover,
.interactive:focus {
  stroke: var(--accent);
  outline: none;
}
.atom-label {
  font: var(--text-sm) var(--font-sans);
  fill: var(--ink);
  text-anchor: middle;
}
.electron-arrow,
.arrow-head {
  fill: none;
  stroke: var(--evidence);
  stroke-width: 2;
  pointer-events: none;
}
.selection,
figcaption {
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  color: var(--ink-soft);
}
code {
  overflow-wrap: anywhere;
}
</style>
