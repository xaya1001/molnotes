<script setup lang="ts">
import { computed, ref } from "vue";
import type { PreviewRequest } from "../../shared/content-preview.ts";
import RequestText from "./RequestText.vue";
const { request } = defineProps<{ request: PreviewRequest }>();
const showYaml = ref(false);
const showRows = ref(false);
const source = computed(() =>
  request.source.replace(/\r?\n$/, "").split(/\r?\n/),
);
const yamlLines = computed(() => {
  const count = source.value.length;
  const bad = new Set(
    request.errors.map((error) => error.line - request.line - 1),
  );
  const windows: [number, number][] = [];
  for (const index of [...bad].sort((a, b) => a - b)) {
    const from = Math.max(0, index - 2),
      to = Math.min(count - 1, index + 2);
    const previous = windows.at(-1);
    if (previous && from - previous[1] <= 3) previous[1] = to;
    else windows.push([from, to]);
  }
  const lines: ({ line: number; text: string; error: boolean } | null)[] = [];
  for (let i = 0; i < count; i++) {
    if (
      !request.errors.length ||
      showYaml.value ||
      windows.some(([from, to]) => i >= from && i <= to)
    )
      lines.push({
        line: request.line + 1 + i,
        text: source.value[i],
        error: bad.has(i),
      });
    else if (lines.at(-1) !== null) lines.push(null);
  }
  return lines;
});
const chart = computed(() => request.display.chart);
const rows = computed(() =>
  chart.value?.rows.length && chart.value.rows.length > 8 && !showRows.value
    ? chart.value.rows.slice(0, 6)
    : (chart.value?.rows ?? []),
);
const label = computed(
  () =>
    `${request.display.label}请求${request.display.filename && request.display.meta ? `：${request.display.meta}` : ""}${request.errors.length ? `，${request.errors.length} 处错误` : ""}`,
);
function jump(line: number) {
  document
    .getElementById(`${request.id}-L${line}`)
    ?.scrollIntoView({ block: "center" });
}
</script>
<template>
  <figure
    class="request"
    :class="{ 'request--error': request.errors.length }"
    :aria-label="label"
  >
    <div class="request-box">
      <div class="request-head">
        <span class="request-kind"
          ><svg viewBox="0 0 16 16" aria-hidden="true">
            <path :d="request.display.icon" /></svg
          >{{ request.display.label }}</span
        >
        <span v-if="request.errors.length" class="request-count"
          >{{ request.errors.length }} 处错误</span
        >
        <span
          v-if="request.display.meta"
          class="request-meta"
          :class="{ 'request-meta--file': request.display.filename }"
          :title="request.display.meta"
          >{{ request.display.meta }}</span
        >
      </div>
      <template v-if="request.errors.length">
        <div class="request-field">
          <ul class="request-errors">
            <li v-for="(error, i) in request.errors" :key="i">
              <a
                :href="`#${request.id}-L${error.line}`"
                @click.prevent="jump(error.line)"
                >第 {{ error.line }} 行</a
              ><span
                ><code v-if="error.path">{{ error.path }}</code>
                {{ error.message }}</span
              >
            </li>
          </ul>
        </div>
      </template>
      <div v-if="request.display.prompt" class="request-field">
        <p class="eyebrow">生图说明</p>
        <RequestText
          :id="`${request.id}-prompt`"
          :text="request.display.prompt"
        />
      </div>
      <div
        v-if="request.display.states?.length && !request.errors.length"
        class="request-field"
      >
        <ol
          class="request-states"
          :class="{ 'request-states--wrap': request.display.states.length > 4 }"
        >
          <li
            v-for="state in request.display.states"
            :key="state.id"
            class="request-state"
          >
            <div class="request-state-card">
              <span class="request-state-label">{{ state.title }}</span>
              <span
                v-if="state.smiles"
                class="request-smiles"
                :title="state.smiles"
                >{{ state.smiles }}</span
              >
              <span v-if="state.note" class="request-state-note">{{
                state.note
              }}</span>
            </div>
          </li>
        </ol>
      </div>
      <div v-if="chart" class="request-chart">
        <div class="request-field">
          <p class="eyebrow">数据</p>
          <div :id="`${request.id}-data`" class="table-scroll">
            <table class="data-table">
              <thead v-if="chart.columns.length">
                <tr>
                  <th
                    v-for="(column, i) in chart.columns"
                    :key="i"
                    :class="{
                      'request-num':
                        chart.rows.length &&
                        typeof chart.rows[0][i] === 'number',
                    }"
                  >
                    {{ column }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, i) in rows" :key="i">
                  <td
                    v-for="(cell, j) in row"
                    :key="j"
                    :class="{ num: typeof cell === 'number' }"
                  >
                    {{ cell }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <button
            v-if="chart.rows.length > 8"
            type="button"
            class="button button--quiet request-toggle"
            :aria-expanded="showRows"
            :aria-controls="`${request.id}-data`"
            @click="showRows = !showRows"
          >
            {{ showRows ? "收起" : `展开全部 ${chart.rows.length} 行` }}
          </button>
        </div>
        <div>
          <div class="request-field">
            <p class="eyebrow">坐标轴</p>
            <dl class="request-axes">
              <template v-for="(axis, i) in chart.axes" :key="i"
                ><dt>{{ axis.label }}</dt>
                <dd>{{ axis.text }}</dd></template
              >
            </dl>
          </div>
          <div class="request-field">
            <p class="eyebrow">要点</p>
            <RequestText
              :id="`${request.id}-point`"
              :text="chart.point"
              point
            />
          </div>
        </div>
      </div>
      <div
        v-if="request.display.yaml || request.errors.length"
        class="request-field"
      >
        <button
          v-if="!request.errors.length"
          type="button"
          class="button button--quiet request-toggle"
          :aria-expanded="showYaml"
          :aria-controls="`${request.id}-yaml`"
          @click="showYaml = !showYaml"
        >
          {{ showYaml ? "收起 YAML" : `查看 YAML（${source.length} 行）` }}
        </button>
        <div
          v-show="showYaml || request.errors.length"
          :id="`${request.id}-yaml`"
          class="request-code"
        >
          <template v-for="(row, i) in yamlLines" :key="i"
            ><div
              v-if="row"
              :id="`${request.id}-L${row.line}`"
              class="request-line"
              :class="{ 'request-line--error': row.error }"
            >
              <span class="request-ln">{{ row.line }}</span
              ><span class="request-src">{{ row.text || " " }}</span>
            </div>
            <div v-else class="request-gap" aria-hidden="true">⋯</div></template
          >
        </div>
        <button
          v-if="request.errors.length"
          type="button"
          class="button button--quiet request-toggle"
          :aria-expanded="showYaml"
          :aria-controls="`${request.id}-yaml`"
          @click="showYaml = !showYaml"
        >
          {{
            showYaml ? "只看出错位置" : `查看完整 YAML（${source.length} 行）`
          }}
        </button>
      </div>
    </div>
    <figcaption v-if="request.caption" class="note-caption">
      {{ request.caption }}
    </figcaption>
  </figure>
</template>

<style>
/* ---- Request placeholder ---- */

.prose .request {
  margin: var(--space-6) 0;
}

.request-box {
  padding: var(--space-4) var(--space-5) var(--space-5);
  border: 1.5px dashed var(--rule-strong);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink-soft);
  font: var(--text-sm) / 1.65 var(--font-sans);
  text-align: left;
}

.request--error .request-box {
  border-color: var(--danger);
}

.request-head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-4);
}

.request-kind {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: var(--space-1);
  padding: 0 var(--space-2);
  border-radius: var(--radius-sm);
  background: var(--paper-deep);
  color: var(--ink-soft);
  font: 500 var(--text-xs) / 1.6rem var(--font-sans);
  letter-spacing: 0.04em;
}

.request-kind svg {
  width: 1rem;
  height: 1rem;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linejoin: round;
  stroke-linecap: round;
}

.request--error .request-kind {
  background: var(--danger-soft);
  color: var(--danger);
}

.request-count {
  flex: none;
  color: var(--danger);
  font: 500 var(--text-xs) / 1.5 var(--font-sans);
}

.request-meta {
  min-width: 0;
  margin-left: auto;
  overflow: hidden;
  color: var(--ink-muted);
  font: var(--text-xs) / 1.5 var(--font-sans);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.request-meta--file {
  font-family: var(--font-mono);
}

.request-field + .request-field {
  margin-top: var(--space-4);
}

.request-field > .eyebrow {
  margin-bottom: var(--space-1);
}

/* Long prose fields: four lines, then expand. */
.request-text {
  margin: 0;
  color: var(--ink-soft);
  white-space: pre-line;
}

.request-text[data-clamp]:not(.is-open) {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 4;
  line-clamp: 4;
  overflow: hidden;
}

.request-toggle.button {
  min-height: 2rem;
  margin: var(--space-1) 0 0 calc(-1 * var(--space-2));
  padding: 0 var(--space-2);
  color: var(--accent);
}

.request-toggle.button:hover {
  color: var(--accent-strong);
}

/* Figure frames: a strip in reading order, as the figure will run. */
.prose .request-states {
  display: flex;
  align-items: stretch;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.prose .request-states li + li {
  margin-top: 0;
}

.request-state {
  display: flex;
  flex: 1 1 0;
  gap: var(--space-2);
  min-width: 0;
}
.request-state-card {
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--rule);
  border-radius: var(--radius-sm);
  background: var(--paper);
  line-height: 1.5;
}

.request-states--wrap {
  flex-wrap: wrap;
}
.request-states--wrap .request-state {
  flex-basis: calc((100% - 3 * var(--space-2)) / 4);
  flex-grow: 0;
}
.request,
.request-box,
.request-chart > *,
.request-field {
  min-width: 0;
}
.request .note-caption {
  display: block;
  text-align: center;
}
.request-state-label {
  color: var(--ink);
  font-weight: 500;
}

.request-smiles {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
  color: var(--ink-soft);
  font: var(--text-xs) / 1.5 var(--font-mono);
  overflow-wrap: anywhere;
}

.request-state-note {
  margin-top: auto;
  color: var(--ink-muted);
  font-size: var(--text-xs);
}

/* YAML source with the note file's line numbers. */
.request-code {
  margin: var(--space-2) 0 0;
  padding: var(--space-2) 0;
  border-radius: var(--radius-sm);
  background: var(--paper-deep);
  color: var(--ink);
  font: var(--text-xs) / 1.7 var(--font-mono);
}

.request-line {
  display: grid;
  grid-template-columns: 3.25em minmax(0, 1fr);
}

.request-ln {
  padding-right: var(--space-3);
  color: var(--ink-muted);
  text-align: right;
  user-select: none;
}

.request-src {
  padding-right: var(--space-3);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.request-line--error {
  background: var(--danger-soft);
  box-shadow: inset 2px 0 var(--danger);
}

.request-line--error .request-ln {
  color: var(--danger);
  font-weight: 500;
}

.request-gap {
  padding-left: calc(3.25em - 1ch - var(--space-3));
  color: var(--ink-muted);
  line-height: 1.2;
  user-select: none;
}

/* Errors */
.prose .request-errors {
  margin: 0;
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-sm);
  background: var(--danger-soft);
  color: var(--danger);
  list-style: none;
}

.prose .request-errors li + li {
  margin-top: var(--space-2);
}

.request-errors li {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: var(--space-3);
}

.request-errors a {
  color: inherit;
  font-weight: 500;
  white-space: nowrap;
}

.prose .request code {
  padding: 0;
  background: none;
  font-size: 0.92em;
}

/* Chart: data beside axes and point. */
.request-chart {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
  gap: var(--space-5);
  align-items: start;
}

.request .data-table {
  font-size: var(--text-xs);
  color: var(--ink);
}

.request .data-table th,
.request .data-table td {
  padding: var(--space-1) var(--space-2);
}

.request .data-table th:first-child,
.request .data-table td:first-child {
  padding-left: 0;
}

.request .data-table .num,
.request .data-table .request-num {
  text-align: right;
}

.request-axes {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: var(--space-1) var(--space-3);
  margin: 0;
}

.request-axes dt {
  color: var(--ink);
  font-weight: 500;
}

.request-axes dd {
  margin: 0;
}

.request-point {
  margin: 0;
  padding-left: var(--space-3);
  border-left: 2px solid var(--evidence);
  color: var(--ink);
}

/* Phones */
@media (max-width: 640px) {
  .request-box {
    padding: var(--space-3) var(--space-4) var(--space-4);
  }

  .prose .request-states {
    flex-direction: column;
  }
  .request-state {
    flex-direction: column;
  }
  .request-states--wrap .request-state {
    flex-basis: auto;
  }

  .request-chart {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-4);
  }

  .prose .request-errors {
    padding: var(--space-3);
  }

  .request-errors li {
    grid-template-columns: minmax(0, 1fr);
    gap: 0;
  }
}
</style>
