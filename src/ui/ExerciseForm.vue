<script setup lang="ts">
import { ref } from "vue";
defineProps<{ prompt: string; canSubmit: boolean }>();
const emit = defineEmits<{ submit: [] }>();
const submitted = ref(false);
function submit() {
  submitted.value = true;
  emit("submit");
}
</script>
<template>
  <section aria-label="练习">
    <h3>
      <slot name="prompt">{{ prompt }}</slot>
    </h3>
    <slot :submitted="submitted" />
    <button
      class="button button--primary"
      :disabled="submitted || !canSubmit"
      @click="submit"
    >
      提交
    </button>
    <div v-if="submitted" class="reveal" role="status">
      <slot name="result" />
    </div>
  </section>
</template>
<style scoped>
.reveal {
  margin-block: var(--space-5);
}
</style>
