<script setup lang="ts">
import { computed } from "vue";
import { tableTextPieces } from "./table-text.ts";
const props = defineProps<{ text: string }>();
const pieces = computed(() => tableTextPieces(props.text));
</script>
<template>
  <span class="table-text"
    ><template v-for="(piece, i) in pieces" :key="i">
      <br v-if="piece.newline" />
      <span v-else :class="{ quantity: piece.quantity }">
        <template v-for="(run, j) in piece.runs" :key="j">
          <component :is="run.bold ? 'strong' : 'span'">
            <component :is="run.italic ? 'em' : 'span'">
              <component
                :is="
                  run.script === 'sub'
                    ? 'sub'
                    : run.script === 'super'
                      ? 'sup'
                      : 'span'
                "
                >{{ run.text }}</component
              >
            </component>
          </component>
        </template>
      </span>
    </template></span
  >
</template>

<style scoped>
sub,
sup {
  line-height: 0;
}
.quantity {
  white-space: nowrap;
}
</style>
