<script setup lang="ts">
import { computed, ref } from "vue";
import MoleculeView from "./MoleculeView.vue";
import MolecularProperties from "./MolecularProperties.vue";
import type { MoleculeData } from "./chemistry/types";
const props = defineProps<{
  site: string;
  variants: readonly MoleculeData[];
}>();
const index = ref(0);
const current = computed(
  () => props.variants[index.value] ?? props.variants[0],
);
</script>
<template>
  <section aria-label="改一个基团">
    <label class="field"
      >{{ site
      }}<select v-model="index" class="input">
        <option
          v-for="(variant, i) in variants"
          :key="variant.smiles"
          :value="i"
        >
          {{ variant.name }}
        </option>
      </select></label
    >
    <MoleculeView v-bind="current" /><MolecularProperties
      :smiles="current.smiles"
    />
  </section>
</template>
