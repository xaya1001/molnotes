<script setup lang="ts">
import { computed } from "vue";
import TableStructure from "./TableStructure.vue";
import type { TableCell, TableSpan } from "./blocks.ts";
import { paragraphPieces, sourceIdsOf } from "./chapter-text.ts";
import { useTopic } from "./context.ts";
import TopicRefs from "./TopicRefs.vue";

/**
 * A captioned three-line table. A cell is text (where `[1,2]` becomes source
 * buttons), a link or a compound drawing; numeric cells align right; with `rowHeader` the first
 * cell of each row is a row header.
 */
const props = defineProps<{
  caption: string;
  columns: string[];
  spans?: TableSpan[];
  rows: TableCell[][];
  note?: string;
  rowHeader?: boolean;
}>();
const text = (cell: TableCell) =>
  typeof cell === "string"
    ? cell
    : "text" in cell
      ? cell.text
      : cell.figure.ref;
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
const { content } = useTopic();
const sourceIds = sourceIdsOf(content.sources);
const pieces = (cell: string) =>
  paragraphPieces(cell, [], new Set(), sourceIds);
const numeric = (cell: TableCell) => /^<?\d+(\.\d+)?%?$/.test(text(cell));
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
              {{ group.label }}
            </th>
          </tr>
          <tr>
            <th v-for="column in columns" :key="column" scope="col">
              {{ column }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.map(text).join('|')">
            <component
              :is="rowHeader && i === 0 ? 'th' : 'td'"
              v-for="(cell, i) in row"
              :key="i"
              :scope="rowHeader && i === 0 ? 'row' : undefined"
              :class="{ num: i > 0 && numeric(cell) }"
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
                >{{ cell.text }}</a
              >
              <template v-for="(piece, j) in pieces(cell)" v-else :key="j">
                <TopicRefs v-if="piece.kind === 'refs'" :ids="piece.ids" />
                <template v-else-if="piece.kind === 'text'">{{
                  piece.text
                }}</template>
              </template>
            </component>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="note" class="caption">{{ note }}</p>
  </figure>
</template>

<style scoped>
.column-groups th {
  text-align: center;
}
.column-groups th:empty {
  border-bottom: none;
}
.title {
  padding: 0 0 var(--space-2);
  color: var(--ink);
  font-weight: 600;
  text-align: start;
  caption-side: top;
}
</style>
