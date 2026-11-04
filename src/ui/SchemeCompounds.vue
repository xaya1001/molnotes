<script setup lang="ts">
import MoleculeView from "./MoleculeView.vue";
import type { SchemeCompound } from "../../shared/reaction-scheme.ts";
defineProps<{
  compounds: readonly SchemeCompound[];
  coordinates: Record<string, string>;
}>();
</script>
<template>
  <div class="scheme-compounds">
    <template
      v-for="(compound, i) in compounds"
      :key="`${compound.number}-${i}`"
    >
      <span v-if="i" class="plus" aria-label="加">+</span>
      <MoleculeView
        :name="compound.name"
        :smiles="coordinates[compound.number] ?? compound.smiles"
        :abbreviations="compound.abbreviations"
        ><template #caption
          ><strong class="compound-number">{{
            compound.number
          }}</strong></template
        ></MoleculeView
      >
    </template>
  </div>
</template>
<style scoped>
.scheme-compounds {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  min-width: 0;
  max-width: 100%;
}
.scheme-compounds :deep(.molecule) {
  flex: 0 1 auto;
}
.scheme-compounds :deep(figcaption) {
  text-align: center;
  margin-top: var(--space-1);
  color: var(--ink);
}
.compound-number {
  font-weight: 700;
}
.plus {
  margin-bottom: var(--scheme-caption-height);
  font: var(--text-xl) var(--font-sans);
}
@media (max-width: 640px) {
  .scheme-compounds {
    flex-wrap: wrap;
  }
}
</style>
