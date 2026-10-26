<script setup lang="ts">
import MoleculeView from "./MoleculeView.vue";
import type { ReactionStep } from "./chemistry/types";
defineProps<{ step: ReactionStep }>();
</script>
<template>
  <section :aria-label="step.title">
    <h3>{{ step.title }}</h3>
    <div class="reaction">
      <div>
        <MoleculeView
          v-for="(mol, i) in step.reactants"
          :key="i"
          v-bind="mol"
        />
      </div>
      <div class="conditions">
        <p>{{ step.reagents }}</p>
        <span class="arrow" aria-label="生成">⟶</span>
        <p>{{ step.conditions }}</p>
        <p v-if="step.yield">收率：{{ step.yield }}</p>
      </div>
      <div>
        <MoleculeView v-for="(mol, i) in step.products" :key="i" v-bind="mol" />
      </div>
    </div>
    <p>{{ step.explanation }}</p>
  </section>
</template>
<style scoped>
.reaction {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(8rem, 0.6fr) minmax(0, 1fr);
  gap: var(--space-3);
  align-items: center;
}
.conditions {
  text-align: center;
  font: var(--text-sm)/var(--leading-body) var(--font-sans);
}
.arrow {
  font-size: var(--text-3xl);
  color: var(--accent);
}
@media (max-width: 640px) {
  .reaction {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
