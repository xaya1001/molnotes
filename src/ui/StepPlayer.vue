<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
const props = defineProps<{
  label: string;
  title?: string;
  steps: readonly { title?: string; text?: string; state?: string }[];
}>();
const index = ref(0);
const playing = ref(false);
const progress = ref(1);
const speed = ref(1);
const reduced = ref(false);
const finished = ref(false);
let fresh = true;
const speeds = [0.5, 1, 1.5, 2];
const duration = 2200;
const dwellDuration = 1400;
let dwell = 0;
let frame = 0;
const running = ref(false);
let last = 0;
let media: MediaQueryList;
const complete = computed(() => progress.value >= 1);
function stop() {
  cancelAnimationFrame(frame);
  frame = 0;
  running.value = false;
}
function run() {
  if (!frame) {
    running.value = true;
    last = performance.now();
    frame = requestAnimationFrame(tick);
  }
}
function tick(now: number) {
  const elapsed = (now - last) * speed.value;
  last = now;
  if (!complete.value)
    progress.value = Math.min(1, progress.value + elapsed / duration);
  else if (playing.value) {
    dwell += elapsed;
    if (dwell >= dwellDuration) {
      if (index.value < props.steps.length - 1) {
        index.value++;
        progress.value = reduced.value ? 1 : 0;
        dwell = 0;
      } else {
        playing.value = false;
        finished.value = true;
      }
    }
  }
  if (
    complete.value &&
    !playing.value &&
    index.value === props.steps.length - 1
  )
    finished.value = true;
  frame = playing.value || !complete.value ? requestAnimationFrame(tick) : 0;
  running.value = frame !== 0;
}
function go(next: number, animate = true) {
  index.value = Math.max(0, Math.min(props.steps.length - 1, next));
  progress.value = animate && !reduced.value ? 0 : 1;
  dwell = 0;
  finished.value =
    animate &&
    !playing.value &&
    index.value === props.steps.length - 1 &&
    complete.value;
  fresh = !animate;
  if (playing.value || !complete.value) run();
}
function pause() {
  playing.value = false;
  stop();
}
function toggle() {
  if (playing.value || (running.value && !complete.value)) {
    pause();
    return;
  }
  if (finished.value) go(0);
  else if (fresh) go(index.value);
  playing.value = true;
  run();
}
function reset() {
  pause();
  go(0, false);
}
function changeSpeed() {
  speed.value = speeds[(speeds.indexOf(speed.value) + 1) % speeds.length];
}
function keydown(event: KeyboardEvent) {
  if (props.steps.length === 1) return;
  if (event.key === " " && (event.target as HTMLElement).closest("button"))
    return;
  if (event.key === " ") {
    event.preventDefault();
    toggle();
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    go(index.value + 1);
  } else if (event.key === "ArrowLeft") {
    event.preventDefault();
    go(index.value - 1);
  } else if (event.key === "Escape") {
    event.preventDefault();
    reset();
  }
}
function visibility() {
  if (document.hidden) pause();
}
function motionPreference() {
  reduced.value = media.matches;
  if (reduced.value) progress.value = 1;
}
onMounted(() => {
  media = matchMedia("(prefers-reduced-motion: reduce)");
  motionPreference();
  media.addEventListener("change", motionPreference);
  document.addEventListener("visibilitychange", visibility);
});
onBeforeUnmount(() => {
  stop();
  media.removeEventListener("change", motionPreference);
  document.removeEventListener("visibilitychange", visibility);
});

watch(() => props.steps, reset);
</script>
<template>
  <section class="player" tabindex="0" :aria-label="label" @keydown="keydown">
    <div v-if="title || $slots.head" class="head">
      <h3 v-if="title">{{ title }}</h3>
      <slot name="head" />
    </div>
    <slot :index="index" :progress="progress" :reduced="reduced" />
    <div class="step-caption" aria-live="polite" aria-atomic="true">
      <span class="number">{{ String(index + 1).padStart(2, "0") }}</span>
      <div>
        <h4 v-if="steps[index].title">{{ steps[index].title }}</h4>
        <div v-if="steps[index].state" class="state">
          {{ steps[index].state }}
        </div>
        <p v-if="steps[index].text">{{ steps[index].text }}</p>
      </div>
    </div>
    <slot name="summary" :index="index" :progress="progress" />
    <table
      v-if="steps.length > 1"
      class="trace"
      :class="{ 'frame-trace': !$slots['trace-row'] }"
    >
      <thead v-if="$slots['trace-head']">
        <tr>
          <th scope="col"><span class="visually-hidden">步骤</span></th>
          <th scope="col">事件</th>
          <slot name="trace-head" />
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="(item, i) in steps"
          :key="i"
          :aria-current="i === index ? 'step' : undefined"
          :class="{ current: i === index, future: i > index }"
          @click="go(i)"
        >
          <td class="n">
            <button
              type="button"
              :aria-label="`步骤 ${i + 1}`"
              @click.stop="go(i)"
            >
              {{ i + 1 }}
            </button>
          </td>
          <td>
            <span v-if="item.title">{{ item.title }}</span>
            <span v-else class="step-summary">{{ item.text }}</span>
          </td>
          <slot name="trace-row" :index="i" />
        </tr>
      </tbody>
    </table>
    <div v-if="steps.length > 1" class="controls">
      <button
        type="button"
        aria-label="上一步"
        :disabled="index === 0"
        @click="go(index - 1)"
      >
        ‹
      </button>
      <button
        type="button"
        class="primary"
        :aria-label="
          playing || (running && !complete)
            ? '暂停'
            : finished
              ? '重播'
              : '播放'
        "
        @click="toggle"
      >
        {{
          playing || (running && !complete)
            ? "❚❚ 暂停"
            : finished
              ? "▶ 重播"
              : "▶ 播放"
        }}
      </button>
      <button
        type="button"
        aria-label="下一步"
        :disabled="index === steps.length - 1"
        @click="go(index + 1)"
      >
        ›
      </button>
      <button type="button" aria-label="播放速度" @click="changeSpeed">
        {{ speed }}×
      </button>
      <button type="button" aria-label="回到第一步" @click="reset">↺</button>
      <span class="count">{{ index + 1 }} / {{ steps.length }}</span>
    </div>
  </section>
</template>
<style scoped>
.player {
  background: var(--surface);
  border: 1px solid var(--rule);
  border-radius: var(--radius);
  margin: var(--space-6) 0;
}
.head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-4) var(--space-5) var(--space-2);
}
.head h3,
.step-caption h4 {
  margin: 0;
  font-size: var(--text-base);
  font-weight: 600;
  line-height: 1.6;
}
button {
  font: 500 var(--text-sm) var(--font-sans);
  cursor: pointer;
}
.step-caption {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--space-1) var(--space-4);
  margin: var(--space-1) var(--space-5) var(--space-4);
  padding: var(--space-3) var(--space-4);
  border-left: 3px solid var(--accent);
  background: var(--paper);
}
.number {
  font: 500 var(--text-sm) var(--font-mono);
  color: var(--surface);
  background: var(--accent);
  border-radius: var(--radius-sm);
  padding: var(--space-1) var(--space-2);
  align-self: start;
}
.state {
  font: 500 var(--text-sm) / 1.6 var(--font-mono);
  color: var(--accent);
}
.step-caption p {
  margin: var(--space-1) 0 0;
  color: var(--ink-soft);
  font-size: var(--text-base);
  line-height: 1.75;
}
th {
  font-weight: 500;
  text-align: left;
  font-size: var(--text-xs);
  color: var(--ink-muted);
}
.trace {
  width: 100%;
  border-collapse: collapse;
  border-top: 1px solid var(--rule);
  font-size: var(--text-sm);
}
.frame-trace {
  table-layout: fixed;
}
.step-summary {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
th,
td {
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--rule);
}
td {
  color: var(--ink-soft);
}
tbody tr {
  cursor: pointer;
}
tbody tr:hover td {
  background: var(--paper);
}
tbody tr.current td {
  background: var(--accent-soft);
  color: var(--ink);
}
tr.future td {
  color: var(--ink-muted);
  opacity: 0.6;
}
.n {
  width: 2.5rem;
}
.n button {
  display: inline-grid;
  place-items: center;
  width: 1.4rem;
  height: 1.4rem;
  border-radius: 50%;
  border: 1px solid currentColor;
  color: inherit;
  background: transparent;
  padding: 0;
  font: 500 var(--text-xs) var(--font-mono);
}
.current .n button {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--surface);
}
.controls {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-5);
}
.controls button {
  border: 1px solid var(--rule-strong);
  background: var(--surface);
  color: var(--ink);
  border-radius: var(--radius);
  padding: var(--space-2) var(--space-3);
  min-width: 2.4rem;
}
.controls button:disabled {
  opacity: 0.5;
  cursor: default;
}
.controls .primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--surface);
  min-width: 5.5rem;
}
.count {
  font: 500 var(--text-sm) var(--font-mono);
  color: var(--ink-muted);
  margin-left: auto;
  white-space: nowrap;
}
@media (max-width: 560px) {
  .count {
    display: none;
  }
  .controls {
    padding-inline: var(--space-3);
  }
}
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    transition: none !important;
  }
}
</style>
