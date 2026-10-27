<script setup lang="ts">
import { computed } from "vue";
import { sourceLink, patentData, type PageRef } from "./patent.ts";
import { useTopic } from "./context.ts";
import UiFigure from "../UiFigure.vue";
const props = defineProps<{
  reference: PageRef;
  source?: string;
  image?: boolean;
}>();
const data = patentData(useTopic().content);
const src = computed(
  () =>
    data.sources?.[
      props.reference.source ??
        props.source ??
        Object.keys(data.sources ?? {})[0]
    ],
);
</script>
<template>
  <UiFigure
    v-if="image && (reference.asset || src)"
    :src="
      reference.asset ?? src!.image.replace('{page}', String(reference.page))
    "
    :alt="`原文 p.${reference.page}`"
    :caption="`原文 p.${reference.page}`"
  />
  <RouterLink
    v-for="page in Array.from(
      { length: (reference.end ?? reference.page) - reference.page + 1 },
      (_, i) => reference.page + i,
    )"
    :key="page"
    class="ref"
    :to="
      sourceLink(
        {
          ...reference,
          page,
          rect: page === reference.page ? reference.rect : undefined,
        },
        source,
      )
    "
    >原文 p.{{ page }}</RouterLink
  >
</template>
