<script setup lang="ts">
import { computed, ref } from "vue";
import MoleculeView from "../MoleculeView.vue";
import type { SpectrumBlock } from "./blocks.ts";
import { useTopic } from "./context.ts";

/**
 * A peak list beside its molecule. The reader picks a peak to read its shift,
 * integration and multiplicity; once `assigned` (the block's `assignAfter`
 * predictions are answered) the pick also highlights the peak's atoms and
 * shows the assignment.
 */
const props = defineProps<{ block: SpectrumBlock; assigned: boolean }>();
const { content } = useTopic();
const peaks = computed(() => content.dataOf(props.block.peaks));
const current = ref(peaks.value[0].id);
const peak = computed(
  () => peaks.value.find((item) => item.id === current.value) ?? peaks.value[0],
);
</script>

<template>
  <section aria-label="谱峰" class="spectrum">
    <figure class="figure">
      <figcaption v-if="block.caption" class="title">
        {{ block.caption }}
      </figcaption>
      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th scope="col">δ / ppm</th>
              <th scope="col">H</th>
              <th scope="col">裂分</th>
              <th scope="col">J</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="item in peaks"
              :key="item.id"
              :aria-selected="item.id === current"
              :class="{ current: item.id === current }"
            >
              <td>
                <button
                  class="button button--quiet"
                  type="button"
                  :aria-pressed="item.id === current"
                  @click="current = item.id"
                >
                  {{ item.ppm }}
                </button>
              </td>
              <td class="num">{{ item.hydrogens }}</td>
              <td>{{ item.multiplicity }}</td>
              <td>{{ item.j ?? "—" }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </figure>
    <MoleculeView
      :name="block.molecule.name"
      :smiles="block.molecule.smiles"
      :highlight-atoms="assigned ? peak.atoms : []"
    />
    <p aria-live="polite">
      δ {{ peak.ppm }}，{{ peak.hydrogens }} H，{{ peak.multiplicity
      }}<template v-if="peak.j">，J = {{ peak.j }}</template
      ><template v-if="assigned">：{{ peak.assignment }}</template>
    </p>
  </section>
</template>

<style scoped>
.title {
  margin: 0 0 var(--space-2);
  color: var(--ink);
  font-weight: 600;
}
.current td {
  background: var(--surface-raised, transparent);
}
</style>
