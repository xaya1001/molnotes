<script setup lang="ts">
import { reactive, ref } from "vue";
import { captionParts } from "../../shared/prose-format.ts";
import type { MoleculeAbbreviation } from "../../shared/molecule-abbreviations.ts";
import { moleculeBondLength } from "./chemistry/drawing.ts";
import { useGroupAlignment } from "./chemistry/group-alignment.ts";
import { useFigureGrid } from "./figure-grid.ts";
import { useFigureWidths } from "./figure-width.ts";
import MoleculeView from "./MoleculeView.vue";
import ProseCaption from "./ProseCaption.vue";

const props = defineProps<{
  molecules: {
    smiles: string;
    caption: string;
    detail?: string;
    abbreviations?: readonly MoleculeAbbreviation[];
    highlightAtoms?: readonly number[];
  }[];
}>();
const root = ref<HTMLElement>();
const widths = useFigureWidths(root);
const naturalWidths = reactive(new Map<string, number>());
const key = (index: number) =>
  JSON.stringify([
    index,
    props.molecules[index].smiles,
    props.molecules[index].abbreviations,
  ]);
const { template, ready } = useGroupAlignment(() =>
  props.molecules.map(({ smiles }) => smiles),
);
const grid = useFigureGrid(
  widths,
  () => props.molecules.map((_, index) => naturalWidths.get(key(index)) ?? 0),
  () => 20 / moleculeBondLength,
);
</script>

<template>
  <div ref="root" class="molecule-group">
    <p v-if="!ready" role="status">正在绘制结构…</p>
    <div v-else class="figure-card-grid" :style="grid.style">
      <MoleculeView
        v-for="(mol, index) in molecules"
        :key="key(index)"
        grouped
        :alignment="template"
        :scale="grid.scale"
        :smiles="mol.smiles"
        :name="captionParts(mol.caption).join('')"
        :abbreviations="mol.abbreviations"
        :highlight-atoms="mol.highlightAtoms"
        @measure="naturalWidths.set(key(index), $event)"
      >
        <template #caption>
          <ProseCaption :text="mol.caption" />
          <template v-if="mol.detail"
            ><br /><ProseCaption :text="mol.detail"
          /></template>
        </template>
      </MoleculeView>
    </div>
  </div>
</template>
