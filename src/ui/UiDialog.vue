<script setup lang="ts">
import {
  DialogRoot,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogTitle,
  DialogClose,
} from "reka-ui";

defineOptions({ inheritAttrs: false });

withDefaults(
  defineProps<{
    title: string;
    size?: "normal" | "full";
    closeLabel?: string;
  }>(),
  { size: "normal", closeLabel: "关闭" },
);
const open = defineModel<boolean>("open", { required: true });
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay class="ui-dialog-overlay" />
      <DialogContent
        v-bind="$attrs"
        class="ui-dialog"
        :class="`ui-dialog--${size}`"
        :aria-describedby="undefined"
      >
        <div class="ui-dialog-panel">
          <header class="ui-dialog-head">
            <DialogTitle as="h2">{{ title }}</DialogTitle>
            <div class="ui-dialog-tools">
              <slot name="toolbar" />
              <DialogClose
                class="button button--quiet button--icon"
                type="button"
                :aria-label="closeLabel"
              >
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="m4 4 8 8M12 4l-8 8" />
                </svg>
              </DialogClose>
            </div>
          </header>
          <div class="ui-dialog-body">
            <slot />
          </div>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style scoped>
.ui-dialog {
  position: fixed;
  z-index: 50;
  inset: 0;
  margin: auto;
  height: fit-content;
  width: min(40rem, calc(100vw - 2rem));
  /* Match the browser dialog width constraint on narrow viewports. */
  max-width: calc(100% - 2em - 6px);
  max-height: calc(100vh - 4rem);
  padding: 0;
  border: 1px solid var(--rule);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink);
  box-shadow: var(--shadow-float);
}

.ui-dialog--full {
  width: calc(100vw - 2rem);
  height: calc(100vh - 2rem);
  max-width: none;
  max-height: none;
}

.ui-dialog-overlay {
  position: fixed;
  z-index: 50;
  inset: 0;
  background: rgb(28 30 34 / 0.45);
}

.ui-dialog-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  max-height: inherit;
}

.ui-dialog-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2) var(--space-4);
  padding: var(--space-2) var(--space-2) var(--space-2) var(--space-5);
  border-bottom: 1px solid var(--rule);
}

h2 {
  margin: 0;
  font: 600 var(--text-base) / 1.4 var(--font-serif);
}

.ui-dialog-tools {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1);
  margin-left: auto;
}

svg {
  width: 1.1rem;
  height: 1.1rem;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
}

.ui-dialog-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: var(--space-5);
}

.ui-dialog--full .ui-dialog-body {
  padding: 0;
}
</style>
