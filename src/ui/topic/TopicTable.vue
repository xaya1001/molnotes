<script setup lang="ts">
import type { TableCell } from "./blocks";
import { paragraphPieces, sourceIdsOf } from "./chapter-text";
import { useTopic } from "./context";
import TopicRefs from "./TopicRefs.vue";

/**
 * A captioned three-line table. A cell is text (where `[1,2]` becomes source
 * buttons) or a link; numeric cells align right; with `rowHeader` the first
 * cell of each row is a row header.
 */
defineProps<{
  caption: string;
  columns: string[];
  rows: TableCell[][];
  note?: string;
  rowHeader?: boolean;
}>();
const text = (cell: TableCell) => (typeof cell === "string" ? cell : cell.text);
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
              <a
                v-if="typeof cell !== 'string'"
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
.title {
  padding: 0 0 var(--space-2);
  color: var(--ink);
  font-weight: 600;
  text-align: start;
  caption-side: top;
}
</style>
