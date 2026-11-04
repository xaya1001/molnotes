<script setup lang="ts">
import ReactionStep from "./ReactionStep.vue";
import MoleculeView from "./MoleculeView.vue";
import type { SubstrateScope } from "../../shared/reaction-scheme.ts";
defineProps<{ scope: SubstrateScope }>();
</script>
<template>
  <section class="substrate-scope" :aria-label="scope.scheme.title">
    <ReactionStep :step="scope.scheme" />
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th scope="col">编号</th>
            <th v-for="column in scope.groups" :key="column.key" scope="col">
              {{ column.label }}
            </th>
            <th scope="col">收率</th>
            <th v-for="column in scope.readings" :key="column.key" scope="col">
              {{ column.label }}
            </th>
            <th scope="col">产物</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in scope.rows" :key="row.number">
            <th scope="row">
              <strong>{{ row.number }}</strong>
            </th>
            <td v-for="column in scope.groups" :key="column.key">
              {{ row.substituents[column.key] }}
            </td>
            <td>{{ row.yield }}</td>
            <td v-for="column in scope.readings" :key="column.key">
              {{ row.readings[column.key] }}
            </td>
            <td>
              <details>
                <summary :aria-label="`查看产物 ${row.number}`">结构</summary>
                <MoleculeView v-bind="row.product"
                  ><template #caption
                    ><strong>{{ row.number }}</strong></template
                  ></MoleculeView
                >
              </details>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
<style scoped>
th,
td {
  font-size: var(--text-sm);
}
summary {
  cursor: pointer;
  font-weight: 500;
}
details[open] {
  min-width: var(--scheme-arrow-max);
}
</style>
