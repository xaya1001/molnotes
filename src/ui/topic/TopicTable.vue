<script setup lang="ts">
import { computed } from "vue";
import { tableTextAlign, tableColumnStyle } from "./table-text.ts";
import { provideTableStructureScales } from "./table-structure-scale.ts";
import TableText from "./TableText.vue";
import TableStructure from "./TableStructure.vue";
import type { TableRow, TableSpan } from "./blocks.ts";
import { paragraphPieces, sourceIdsOf } from "./chapter-text.ts";
import { useTopic } from "./context.ts";
import TopicRefs from "./TopicRefs.vue";

/**
 * A captioned three-line table. A cell is text (where `[1,2]` becomes source
 * buttons), a link or a compound drawing; data columns are centered; with `rowHeader` the first
 * cell of each row is a row header.
 */
provideTableStructureScales();
const props = defineProps<{
  caption: string;
  columns: string[];
  spans?: TableSpan[];
  rows: TableRow[];
  note?: string;
  rowHeader?: boolean;
}>();
const groups = computed(() => {
  const result: { label: string; colspan: number }[] = [];
  for (let column = 1; column <= props.columns.length;) {
    const span = props.spans?.find((s) => s.from === column);
    const colspan = span ? span.to - span.from + 1 : 1;
    result.push({ label: span?.label ?? "", colspan });
    column += colspan;
  }
  return result;
});
const columnStyles = computed(() =>
  props.columns.map((_, column) =>
    tableColumnStyle(
      props.rows.flatMap((row) => {
        if (typeof row === "string") return [];
        const cell = row[column];
        return [
          typeof cell === "string" ? cell : "text" in cell ? cell.text : "",
        ];
      }),
    ),
  ),
);
const { content } = useTopic();
const sourceIds = sourceIdsOf(content.sources);
const pieces = (cell: string) =>
  paragraphPieces(cell, [], new Set(), sourceIds);
</script>

<template>
  <figure class="figure">
    <div class="table-scroll">
      <table class="data-table">
        <caption class="title">
          {{
            caption
          }}
        </caption>
        <thead>
          <tr v-if="spans?.length" class="column-groups">
            <th
              v-for="(group, i) in groups"
              :key="i"
              :colspan="group.colspan"
              :scope="group.label ? 'colgroup' : undefined"
            >
              <span v-if="group.label" class="group-label"
                ><TableText :text="group.label"
              /></span>
            </th>
          </tr>
          <tr>
            <th
              v-for="(column, i) in columns"
              :key="column"
              scope="col"
              :class="{ 'short-heading': tableTextAlign(column) === 'center' }"
              :style="{ textAlign: columnStyles[i].textAlign }"
            >
              <TableText :text="column" />
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, r) in rows"
            :key="r"
            :class="{ 'group-row': typeof row === 'string' }"
          >
            <th
              v-if="typeof row === 'string'"
              :colspan="columns.length"
              scope="rowgroup"
            >
              <TableText :text="row" />
            </th>
            <template v-else>
              <component
                :is="rowHeader && i === 0 ? 'th' : 'td'"
                v-for="(cell, i) in row"
                :key="i"
                :scope="rowHeader && i === 0 ? 'row' : undefined"
                :style="columnStyles[i]"
              >
                <TableStructure
                  v-if="typeof cell !== 'string' && 'figure' in cell"
                  :reference="cell.figure"
                />
                <a
                  v-else-if="typeof cell !== 'string'"
                  :href="cell.href"
                  :target="
                    cell.href.startsWith('/') && !cell.href.startsWith('//')
                      ? undefined
                      : '_blank'
                  "
                  rel="noreferrer"
                  ><TableText :text="cell.text"
                /></a>
                <template v-for="(piece, j) in pieces(cell)" v-else :key="j">
                  <TopicRefs v-if="piece.kind === 'refs'" :ids="piece.ids" />
                  <TableText
                    v-else-if="piece.kind === 'text'"
                    :text="piece.text"
                  />
                </template>
              </component>
            </template>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="note" class="caption"><TableText :text="note" /></p>
  </figure>
</template>

<style scoped>
.data-table {
  width: auto;
  min-width: 0;
}
.data-table th,
.data-table td {
  text-align: center;
  vertical-align: middle;
  font-weight: 400;
}
.short-heading {
  min-width: var(--table-heading-width);
}
.data-table tbody tr + tr td {
  border-top: none;
}
.column-groups th {
  border-bottom: none;
  padding-inline: var(--space-1);
}
.group-label {
  display: block;
  border-bottom: 1px solid var(--ink);
  padding-bottom: var(--space-2);
}
.group-row th {
  text-align: left;
  padding-block: var(--space-3) var(--space-1);
}
.title {
  padding: 0 0 var(--space-2);
  color: var(--ink);
  font-weight: 600;
  text-align: start;
  caption-side: top;
}
</style>
