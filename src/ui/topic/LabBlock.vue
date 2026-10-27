<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import LineChart from "../LineChart.vue";
import TopicTable from "./TopicTable.vue";
import { labModels, type LabResult } from "../models/catalog.ts";
import type { LabBlock } from "./blocks.ts";

/**
 * A `lab` block: the reader sets the inputs a named model declares, the model
 * runs on every change, and the block shows what it returns: a summary line,
 * readouts and plotted series. A combination the model cannot answer shows
 * its message as an alert.
 */
const props = defineProps<{ block: LabBlock; data?: unknown }>();
const entry = labModels[props.block.model];
if (!entry) throw new Error(`Unknown lab model: ${props.block.model}`);
const model = entry(props.data);
const inputs = model.inputs;
const values = reactive<Record<string, number | string>>(
  Object.fromEntries(
    inputs.map((input) => [
      input.id,
      props.block.defaults?.[input.id] ?? input.default,
    ]),
  ),
);
// The `revealed` part of a result shows after the button and hides again on any change.
const revealed = ref(false);
watch(values, () => {
  revealed.value = false;
});
function applyPreset(preset: Record<string, number | string>) {
  Object.assign(values, preset);
}
const defaults = Object.fromEntries(
  inputs.map((input) => [
    input.id,
    props.block.defaults?.[input.id] ?? input.default,
  ]),
);
const outcome = computed<{ result: LabResult | null; error: string }>(() => {
  try {
    return { result: model.run({ ...values }), error: "" };
  } catch (reason) {
    return {
      result: null,
      error: reason instanceof Error ? reason.message : "输入不正确",
    };
  }
});
</script>

<template>
  <section :aria-label="block.label">
    <h2 v-if="block.title">{{ block.title }}</h2>
    <p v-if="block.intro">{{ block.intro }}</p>
    <div v-if="block.presets || block.reset" class="controls">
      <button
        v-for="preset in block.presets ?? []"
        :key="preset.label"
        class="button"
        type="button"
        @click="applyPreset(preset.values)"
      >
        {{ preset.label }}
      </button>
      <button
        v-if="block.reset"
        class="button button--quiet"
        type="button"
        @click="applyPreset(defaults)"
      >
        恢复默认
      </button>
    </div>
    <div class="inputs">
      <label v-for="input in inputs" :key="input.id"
        >{{ input.label
        }}<template v-if="'unit' in input && input.unit">
          （{{ input.unit }}）</template
        ><select v-if="input.kind === 'select'" v-model="values[input.id]">
          <option
            v-for="option in input.options"
            :key="String(option.value)"
            :value="option.value"
          >
            {{ option.label }}
          </option></select
        ><template v-else-if="input.control === 'range'"
          ><output>{{ values[input.id] }}</output
          ><input
            v-model.number="values[input.id]"
            type="range"
            :min="input.min"
            :max="input.max"
            :step="input.step"
            :aria-label="input.label" /></template
        ><input
          v-else
          v-model.number="values[input.id]"
          type="number"
          :min="input.min"
          :max="input.max"
          :step="input.step"
      /></label>
    </div>
    <p v-if="outcome.error" role="alert">{{ outcome.error }}</p>
    <template v-if="outcome.result">
      <template
        v-for="(part, i) in [
          outcome.result,
          revealed ? outcome.result.revealed : undefined,
        ]"
        :key="i"
      >
        <template v-if="part">
          <div v-if="part.summary" role="status" class="callout">
            {{ part.summary }}
          </div>
          <dl v-if="part.readouts?.length" class="readouts">
            <template v-for="readout in part.readouts" :key="readout.label">
              <dt>{{ readout.label }}</dt>
              <dd class="num">{{ readout.value }}</dd>
            </template>
          </dl>
          <figure
            v-for="(chart, j) in part.charts ?? []"
            :key="j"
            class="figure"
          >
            <figcaption v-if="chart.title" class="title">
              {{ chart.title }}
            </figcaption>
            <LineChart
              :points="chart.points"
              :series="chart.series"
              :x-label="chart.xLabel"
              :y-label="chart.yLabel"
              :x-domain="chart.xDomain"
              :y-domain="chart.yDomain"
            />
          </figure>
          <TopicTable
            v-for="table in part.tables ?? []"
            :key="table.caption"
            :caption="table.caption"
            :columns="table.columns"
            :rows="table.rows"
            :note="table.note"
          />
        </template>
      </template>
      <p v-if="block.reveal && outcome.result.revealed && !revealed">
        <button class="button" type="button" @click="revealed = true">
          {{ block.reveal.label }}
        </button>
      </p>
    </template>
  </section>
</template>

<style scoped>
.inputs {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
  gap: var(--space-3);
  font-family: var(--font-sans);
}
label {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
}
input,
select {
  width: 100%;
  min-width: 0;
  max-width: 100%;
  box-sizing: border-box;
  padding: var(--space-2);
}
.readouts {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
  gap: var(--space-2) var(--space-4);
  font-family: var(--font-sans);
}
.readouts dt,
.readouts dd {
  min-width: 0;
  overflow-wrap: anywhere;
}
.readouts dd {
  margin: 0;
}
@media (max-width: 640px) {
  .readouts {
    grid-template-columns: minmax(0, 1fr);
  }
  .readouts dd {
    margin-bottom: var(--space-3);
  }
}
.controls {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.title {
  margin: 0 0 var(--space-2);
  font-weight: 600;
}
</style>
