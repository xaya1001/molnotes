<script setup lang="ts">
import UiDialog from "./UiDialog.vue";
import type { GlossaryTerm } from "../../scripts/glossary.mjs";
defineProps<{ term?: GlossaryTerm }>();
const open = defineModel<boolean>("open", { required: true });
</script>
<template>
  <UiDialog v-model:open="open" :title="term?.term ?? '术语'">
    <div v-if="term" class="prose">
      <p>{{ term.full }}</p>
      <p>{{ term.definition }}</p>
      <p class="callout">容易混淆：{{ term.confusion }}</p>
      <p>
        <a :href="`/glossary/#${encodeURIComponent(term.term)}`"
          >在全站术语表中查看</a
        >
      </p>
    </div>
  </UiDialog>
</template>
