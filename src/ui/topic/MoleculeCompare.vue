<script setup lang="ts">
import { computed, ref } from "vue";
import MoleculeView from "../MoleculeView.vue";
import type { MoleculeData } from "../chemistry/types.ts";

type Item = MoleculeData & { highlightAtoms?: number[]; caption?: string };

/** Two molecules side by side, each chosen from the same list, with a switch for their highlighted atoms. */
const props = defineProps<{
  items: Item[];
  left?: string;
  right?: string;
  highlightLabel?: string;
}>();
const byName = (name: string | undefined, fallback: number) =>
  props.items.find((item) => item.name === name) ?? props.items[fallback];
const left = ref(byName(props.left, 0).name);
const right = ref(byName(props.right, 1).name);
const highlight = ref(false);
const sides = computed(() => [
  { key: "left", label: "左", model: left },
  { key: "right", label: "右", model: right },
]);
const canHighlight = computed(() =>
  props.items.some((item) => item.highlightAtoms?.length),
);
</script>

<template>
  <section aria-label="结构对照" class="compare">
    <div class="controls">
      <label v-for="side in sides" :key="side.key"
        >{{ side.label
        }}<select v-model="side.model.value">
          <option v-for="item in items" :key="item.name" :value="item.name">
            {{ item.name }}
          </option>
        </select></label
      ><label v-if="canHighlight"
        ><input v-model="highlight" type="checkbox" />
        {{ highlightLabel ?? "标出高亮原子" }}</label
      >
    </div>
    <div class="pair">
      <figure v-for="side in sides" :key="side.key" class="figure">
        <MoleculeView
          :key="side.model.value"
          :name="byName(side.model.value, 0).name"
          :smiles="byName(side.model.value, 0).smiles"
          :highlight-atoms="
            highlight ? (byName(side.model.value, 0).highlightAtoms ?? []) : []
          "
        />
        <figcaption v-if="byName(side.model.value, 0).caption" class="caption">
          {{ byName(side.model.value, 0).caption }}
        </figcaption>
      </figure>
    </div>
  </section>
</template>

<style scoped>
.controls {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  align-items: center;
  font-family: var(--font-sans);
}
select {
  margin-inline-start: var(--space-2);
  padding: var(--space-2);
}
.pair {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
  gap: var(--space-3);
}
</style>
