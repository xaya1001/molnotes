<script setup lang="ts">
import { TabsRoot, TabsList, TabsTrigger, TabsContent } from "reka-ui";
import type { TabsBlock } from "./blocks";
import ChapterBlocks from "./ChapterBlocks.vue";

/** Named alternatives (worked examples, cases) shown one at a time; each is a block sequence. */
defineProps<{ block: TabsBlock; chapter: string }>();
</script>

<template>
  <TabsRoot
    as="section"
    :default-value="block.default ?? block.items[0].id"
    :aria-label="block.label"
  >
    <TabsList class="controls" :aria-label="block.label">
      <TabsTrigger
        v-for="item in block.items"
        :key="item.id"
        class="button"
        type="button"
        :value="item.id"
      >
        {{ item.label }}
      </TabsTrigger>
    </TabsList>
    <TabsContent v-for="item in block.items" :key="item.id" :value="item.id">
      <ChapterBlocks :chapter="chapter" :blocks="item.blocks" />
    </TabsContent>
  </TabsRoot>
</template>

<style scoped>
.controls {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
}

[role="tab"][aria-selected="true"] {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent);
}
</style>
