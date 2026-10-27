<script setup lang="ts">
import { computed, ref } from "vue";
import MoleculeView from "../MoleculeView.vue";
import DataScatter from "./DataScatter.vue";
import {
  columnOf,
  formatValue,
  sortRows,
  sourceText,
  type DataCell,
  type DataColumn,
  type DataRow,
  type DataTable,
  type Reading,
} from "./values.ts";

/**
 * A table of numbers as a source printed them, with sorting, a filter by
 * group, any two columns plotted against each other, and one row's structure
 * and source values below. A bound (">10") stays a bound in the table and the
 * plot; a missing cell shows `missing` and is not plotted. Where another
 * source prints a different value, it sits beside the listed one with where it
 * comes from, and the plot says which of the two it uses. The data comes from
 * `defineDataTable`; the numbers, units and wording are all the table's.
 */
const props = withDefaults(
  defineProps<{
    table: DataTable;
    /** Heading above the table. */
    title: string;
    /** Name of the whole region for assistive technology. */
    label: string;
    /** What a row is called, e.g. "化合物". */
    noun?: string;
    /** Header of the first column. */
    idLabel?: string;
    /** Shown for a cell with no value. */
    missing?: string;
    defaultX?: string;
    defaultY?: string;
  }>(),
  { noun: "行", idLabel: "编号", missing: "未测" },
);

const columns = props.table.columns;
const alternates = props.table.alternates;
const sortKey = ref("label");
const direction = ref<"asc" | "desc">("asc");
const groupFilter = ref("all");
const xKey = ref(props.defaultX ?? columns[0].key);
const yKey = ref(
  props.defaultY ?? columns[Math.min(1, columns.length - 1)].key,
);
const use = ref<Reading>(alternates?.plot ?? "listed");
const selected = ref<string | null>(null);

const inGroup = computed(() =>
  groupFilter.value === "all"
    ? props.table.rows
    : props.table.rows.filter((row) => row.group === groupFilter.value),
);
const rows = computed(() =>
  sortRows(inGroup.value, sortKey.value, direction.value),
);
function sortBy(key: string) {
  if (sortKey.value === key)
    direction.value = direction.value === "asc" ? "desc" : "asc";
  else {
    sortKey.value = key;
    direction.value = "asc";
  }
}
function ariaSort(key: string) {
  return sortKey.value !== key
    ? "none"
    : direction.value === "asc"
      ? "ascending"
      : "descending";
}
const chosen = computed(() =>
  props.table.rows.find((row) => row.id === selected.value),
);
const chosenGroup = computed(() =>
  props.table.groups?.items.find((item) => item.id === chosen.value?.group),
);
const chosenAlternates = computed(() =>
  chosen.value
    ? columns.flatMap((column) => {
        const cell = chosen.value?.values[column.key];
        return cell?.alternate?.note
          ? [{ column, note: cell.alternate.note }]
          : [];
      })
    : [],
);
const hasAlternates = computed(() =>
  props.table.rows.some((row) =>
    Object.values(row.values).some((cell) => cell.alternate),
  ),
);
const header = (column: DataColumn) =>
  column.unit ? `${column.label}（${column.unit}）` : column.label;
const show = (cell: DataCell | undefined, column: DataColumn) =>
  formatValue(cell, column, props.missing);
function sourceLine(row: DataRow, column: DataColumn) {
  const cell = row.values[column.key];
  return cell ? sourceText(cell, column) : props.missing;
}
function alternateLine(row: DataRow, column: DataColumn) {
  const alternate = row.values[column.key]?.alternate;
  if (!alternate || !alternates) return undefined;
  const unit = column.sourceUnit ? ` ${column.sourceUnit}` : "";
  return `${alternate.value.raw}${unit}（${alternates.source} ${alternate.where}，原写 ${alternate.printed}）`;
}
</script>
<template>
  <section :aria-label="label">
    <h3>{{ title }}</h3>
    <slot />
    <div v-if="table.groups" class="controls">
      <label class="field"
        >{{ table.groups.label
        }}<select
          v-model="groupFilter"
          class="input"
          :aria-label="table.groups.label"
        >
          <option value="all">全部 {{ table.rows.length }} 个</option>
          <option
            v-for="group in table.groups.items"
            :key="group.id"
            :value="group.id"
          >
            {{ group.label }}（{{
              table.rows.filter((row) => row.group === group.id).length
            }}）
          </option>
        </select></label
      >
    </div>
    <div class="table-scroll">
      <table>
        <caption>
          点列标题排序；点{{
            idLabel
          }}查看详情{{
            hasAlternates && alternates
              ? `；灰色小字是${alternates.alternate}`
              : ""
          }}
        </caption>
        <thead>
          <tr>
            <th :aria-sort="ariaSort('label')">
              <button class="sort" @click="sortBy('label')">
                {{ idLabel }}
              </button>
            </th>
            <th
              v-for="column in columns"
              :key="column.key"
              :aria-sort="ariaSort(column.key)"
            >
              <button class="sort" @click="sortBy(column.key)">
                {{ header(column) }}
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in rows"
            :key="row.id"
            :class="{ chosen: selected === row.id }"
          >
            <th scope="row">
              <button class="pick" @click="selected = row.id">
                {{ row.label }}
              </button>
            </th>
            <td v-for="column in columns" :key="column.key" class="num">
              {{ show(row.values[column.key], column) }}
              <small
                v-if="row.values[column.key]?.alternate && alternates"
                class="main"
                :title="row.values[column.key]?.alternate?.where"
                >{{ alternates.source }}
                {{
                  show(row.values[column.key]?.alternate?.value, column)
                }}</small
              >
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <h3>两列对照</h3>
    <div class="controls">
      <label class="field"
        >横轴<select v-model="xKey" class="input" aria-label="横轴">
          <option v-for="c in columns" :key="c.key" :value="c.key">
            {{ c.label }}
          </option>
        </select></label
      >
      <label class="field"
        >纵轴<select v-model="yKey" class="input" aria-label="纵轴">
          <option v-for="c in columns" :key="c.key" :value="c.key">
            {{ c.label }}
          </option>
        </select></label
      >
      <fieldset v-if="hasAlternates && alternates" class="field">
        <legend>{{ alternates.legend }}</legend>
        <label
          ><input v-model="use" type="radio" value="alternate" />
          {{ alternates.alternate }}</label
        >
        <label
          ><input v-model="use" type="radio" value="listed" />
          {{ alternates.listed }}</label
        >
      </fieldset>
    </div>
    <DataScatter
      :rows="table.rows"
      :x="columnOf(table, xKey)"
      :y="columnOf(table, yKey)"
      :use="use"
      :alternates="alternates"
      :noun="noun"
      :selected="selected"
      :highlight="inGroup.map((row) => row.id)"
      @select="selected = $event"
    />
    <slot name="after-plot" :x="xKey" :y="yKey" :use="use" />

    <section v-if="chosen" class="detail" :aria-label="`所选${noun}`">
      <h4>{{ chosen.name }}</h4>
      <MoleculeView
        v-if="chosen.smiles"
        :name="chosen.name"
        :smiles="chosen.smiles"
      />
      <p class="caption">
        <template v-if="chosenGroup"
          >{{ chosenGroup.label
          }}<template v-if="chosenGroup.where"
            >（{{ chosenGroup.where }}）</template
          >。</template
        >
        <slot name="detail-caption" :row="chosen" />
      </p>
      <dl>
        <template v-for="column in columns" :key="column.key">
          <dt>{{ column.label }}</dt>
          <dd class="num">
            {{ sourceLine(chosen, column) }}
            <small v-if="alternateLine(chosen, column)" class="main"
              ><br />{{ alternateLine(chosen, column) }}</small
            >
          </dd>
        </template>
      </dl>
      <p
        v-for="item in chosenAlternates"
        :key="item.column.key"
        class="callout callout--evidence"
      >
        {{ item.column.label }}：{{ item.note }}
      </p>
      <p
        v-for="note in chosen.notes"
        :key="note"
        class="callout callout--evidence"
      >
        {{ note }}
      </p>
    </section>
    <slot name="footer" />
  </section>
</template>
<style scoped>
.controls {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
  font-family: var(--font-sans);
  margin-block: var(--space-3);
}
fieldset.field {
  border: 0;
  padding: 0;
  margin: 0;
}
fieldset.field label {
  display: inline-block;
  margin-right: var(--space-3);
}
table {
  font-family: var(--font-sans);
  font-size: var(--text-sm);
}
.sort,
.pick {
  font: inherit;
  background: none;
  border: 0;
  padding: 0;
  color: var(--accent);
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
}
th[scope="row"] {
  white-space: nowrap;
}
.num {
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.main {
  display: block;
  color: var(--evidence);
  font-size: var(--text-xs);
}
dd .main {
  display: inline;
}
tr.chosen {
  background: var(--evidence-soft);
}
.detail {
  margin-block: var(--space-5);
  padding: var(--space-4);
  border: 1px solid var(--rule-strong);
  border-radius: var(--radius);
}
dl {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--space-1) var(--space-4);
  font-family: var(--font-sans);
  font-size: var(--text-sm);
}
dt {
  color: var(--ink-soft);
}
dd {
  margin: 0;
}
</style>
