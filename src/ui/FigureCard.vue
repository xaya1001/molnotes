<script setup lang="ts">
import { useTemplateRef } from "vue";
import ProseCaption from "./ProseCaption.vue";

const art = useTemplateRef<HTMLElement>("art");
defineExpose({ art });

defineProps<{ caption?: string; wide?: number; table?: boolean }>();
</script>

<template>
  <figure
    class="figure-card"
    :class="{ 'figure-card--table': table }"
    :style="wide ? { '--figure-width': wide + 'px' } : undefined"
  >
    <div v-if="table && caption" class="figure-card-caption" aria-hidden="true">
      <ProseCaption :text="caption" />
    </div>
    <div ref="art" class="figure-card-art"><slot /></div>
    <figcaption
      v-if="(!table && caption) || $slots.caption"
      class="figure-card-caption"
    >
      <slot name="caption"><ProseCaption :text="caption ?? ''" /></slot>
    </figcaption>
  </figure>
</template>
