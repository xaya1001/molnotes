<script setup lang="ts">
import { ref, watch } from "vue";
import { loadChemistry, properties } from "./chemistry/rdkit.ts";
const props = defineProps<{ smiles: string }>();
const values = ref<ReturnType<typeof properties>>();
const error = ref("");
watch(
  () => props.smiles,
  async (smiles, _, cleanup) => {
    let active = true;
    cleanup(() => {
      active = false;
    });
    values.value = undefined;
    error.value = "";
    try {
      const toolkit = await loadChemistry();
      if (active) values.value = properties(toolkit, smiles);
    } catch (reason) {
      if (active)
        error.value = reason instanceof Error ? reason.message : "性质计算失败";
    }
  },
  { immediate: true },
);
</script>
<template>
  <div aria-label="计算性质" aria-live="polite">
    <p v-if="error" role="alert">{{ error }} · SMILES：{{ smiles }}</p>
    <dl v-else-if="values" class="properties num">
      <div>
        <dt>分子量 / g·mol⁻¹</dt>
        <dd>{{ values.mw.toFixed(2) }}</dd>
      </div>
      <div>
        <dt>cLogP（Crippen）</dt>
        <dd>{{ values.logP.toFixed(2) }}</dd>
      </div>
      <div>
        <dt>TPSA / Å²</dt>
        <dd>{{ values.tpsa.toFixed(2) }}</dd>
      </div>
      <div>
        <dt>氢键供体</dt>
        <dd>{{ values.donors }}</dd>
      </div>
      <div>
        <dt>氢键受体</dt>
        <dd>{{ values.acceptors }}</dd>
      </div>
      <div>
        <dt>可旋转键</dt>
        <dd>{{ values.rotatable }}</dd>
      </div>
    </dl>
    <p v-else role="status">正在计算性质…</p>
    <p class="method">
      RDKit 2026.03.6：平均分子量、Wildman–Crippen cLogP、Ertl TPSA、NumHBD /
      NumHBA、NumRotatableBonds。按所给结构计算，未模拟 pH 或代谢。
    </p>
  </div>
</template>
<style scoped>
.properties {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
  gap: var(--space-3);
  font-family: var(--font-sans);
}
dd {
  margin: 0;
  font-size: var(--text-lg);
}
dt,
.method {
  font-size: var(--text-sm);
  color: var(--ink-muted);
}
</style>
