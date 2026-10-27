<script setup lang="ts">
import type { MatrixCell, MatrixOutcome } from "./model.ts";

/** What the source says about one cell: result, system, locator and the source's own words. */
defineProps<{
  cell: MatrixCell;
  outcome: MatrixOutcome;
  /** Language of the quotes, when it differs from the page's. */
  quoteLang?: string;
}>();
</script>
<template>
  <div class="evidence">
    <p>
      <strong>{{ outcome.label }}</strong>
      <template v-if="cell.scope || cell.system"
        >（{{
          [cell.scope, cell.system].filter(Boolean).join("；")
        }}）</template
      >
    </p>
    <p v-if="cell.gap">{{ cell.gap }}</p>
    <ul v-if="cell.evidence.length">
      <li v-for="item in cell.evidence" :key="item.locator">
        <slot name="source" :id="item.source" />
        {{ item.locator }}
        <blockquote v-if="item.quote" :lang="quoteLang">
          {{ item.quote }}
        </blockquote>
      </li>
    </ul>
    <p v-if="cell.caveat" class="caveat">{{ cell.caveat }}</p>
  </div>
</template>
<style scoped>
.evidence {
  font-family: var(--font-sans);
  font-size: var(--text-sm);
}
ul {
  padding-left: var(--space-5);
}
blockquote {
  margin: var(--space-1) 0 var(--space-3);
  padding-left: var(--space-3);
  border-left: 2px solid var(--rule-strong);
  color: var(--ink-soft);
  font-family: var(--font-serif);
}
.caveat {
  color: var(--evidence);
}
</style>
