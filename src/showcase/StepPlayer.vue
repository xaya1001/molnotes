<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId } from "vue";
import { formatAmount, type PlayerData } from "./step-scenarios.ts";

const props = defineProps<{ data: PlayerData }>();
const arrowId = useId();
const scenarioIndex = ref(0);
const index = ref(0);
const playing = ref(false);
const progress = ref(1);
const speed = ref(1);
const reduced = ref(false);
const speeds = [0.5, 1, 1.5, 2];
const duration = 2200;
const dwellDuration = 1400;
let dwell = 0;
let frame = 0;
const running = ref(false);
let last = 0;
let media: MediaQueryList;
const steps = computed(() => props.data.scenarios[scenarioIndex.value].steps);
const step = computed(() => steps.value[index.value]);
const complete = computed(() => progress.value >= 1);
const shown = computed(() =>
  steps.value.slice(0, index.value + Number(complete.value)),
);
const amounts = computed(() => {
  const values: (number | null)[] = props.data.nodes.map((_, i) =>
    i === 0 ? props.data.input : null,
  );
  for (const item of shown.value)
    item.amounts.forEach((value, i) => {
      if (value !== null) values[i] = value;
    });
  return values;
});
const losses = computed(() =>
  props.data.lossNames.map(
    (_, i) => shown.value.find((item) => item.loss?.index === i)?.loss,
  ),
);
const remaining = computed(
  () =>
    props.data.input -
    losses.value.reduce((sum, loss) => sum + (loss?.amount ?? 0), 0),
);
const split = computed(() => (step.value.loss ? 0.6 : 1));
const moving = computed(() => !reduced.value && !complete.value);
const motion = computed(() => {
  const lossPhase = progress.value >= split.value;
  const raw = lossPhase
    ? (progress.value - split.value) / (1 - split.value)
    : progress.value / split.value;
  const t = raw < 0.5 ? 2 * raw * raw : 1 - Math.pow(-2 * raw + 2, 2) / 2;
  return { lossPhase, t };
});
const transferX = computed(() => {
  const start = props.data.nodes[step.value.from].x + 70;
  const end = props.data.nodes[step.value.to].x - 78;
  return start + (end - start) * motion.value.t;
});

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
      if (index.value < steps.value.length - 1) {
        index.value++;
        progress.value = reduced.value ? 1 : 0;
        dwell = 0;
      } else playing.value = false;
    }
  }
  frame = playing.value || !complete.value ? requestAnimationFrame(tick) : 0;
  running.value = frame !== 0;
}
function go(next: number, animate = true) {
  index.value = Math.max(0, Math.min(steps.value.length - 1, next));
  progress.value = animate && !reduced.value ? 0 : 1;
  dwell = 0;
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
  if (index.value === steps.value.length - 1 && complete.value) go(0);
  playing.value = true;
  run();
}
function reset() {
  pause();
  go(0, false);
}
function changeScenario(value: number) {
  scenarioIndex.value = value;
  reset();
}
function changeSpeed() {
  speed.value = speeds[(speeds.indexOf(speed.value) + 1) % speeds.length];
}
function keydown(event: KeyboardEvent) {
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
</script>

<template>
  <section
    class="player"
    tabindex="0"
    :aria-label="data.title"
    @keydown="keydown"
  >
    <div class="head">
      <h2>{{ data.title }}</h2>
      <div class="seg" role="group" aria-label="场景">
        <button
          v-for="(scenario, i) in data.scenarios"
          :key="scenario.name"
          type="button"
          :aria-pressed="i === scenarioIndex"
          @click="changeScenario(i)"
        >
          {{ scenario.name }}
        </button>
      </div>
    </div>
    <div class="stage">
      <svg viewBox="0 0 720 250" role="img" :aria-label="data.diagramLabel">
        <defs>
          <marker
            :id="arrowId"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0 0L10 5L0 10z" fill="context-stroke" />
          </marker>
        </defs>
        <g
          v-for="edge in data.edges"
          :key="edge.from"
          :class="{
            active:
              step.kind === 'transfer' &&
              step.from === edge.from &&
              step.to === edge.to,
          }"
        >
          <line
            class="edge"
            :x1="data.nodes[edge.from].x + 70"
            y1="95"
            :x2="data.nodes[edge.to].x - 72"
            y2="95"
            :marker-end="`url(#${arrowId})`"
          />
          <text
            class="edge-label"
            :x="(data.nodes[edge.from].x + data.nodes[edge.to].x) / 2"
            y="83"
            text-anchor="middle"
          >
            {{ edge.label }}
          </text>
        </g>
        <g
          v-for="(lossName, i) in data.lossNames"
          :key="lossName"
          class="loss"
          :class="{
            on:
              losses[i] ||
              (moving && motion.lossPhase && step.loss?.index === i),
          }"
        >
          <path :d="`M${data.nodes[i].x} 128 V186`" />
          <text :x="data.nodes[i].x" y="206" text-anchor="middle">
            − {{ formatAmount((losses[i] ?? step.loss)?.amount ?? 0) }}
            {{ data.unit }}
          </text>
          <text :x="data.nodes[i].x" y="224" text-anchor="middle">
            {{ lossName }}
          </text>
        </g>
        <g
          v-for="(node, i) in data.nodes"
          :key="node.name"
          class="node"
          :class="{ active: i === step.from || i === step.to }"
        >
          <rect :x="node.x - 70" y="62" width="140" height="66" rx="8" />
          <text class="name" :x="node.x" y="91" text-anchor="middle">
            {{ node.name }}
          </text>
          <text class="sub" :x="node.x" y="112" text-anchor="middle">
            {{ node.detail }}
          </text>
          <text
            class="amount"
            :class="{ dim: amounts[i] === 0 }"
            :x="node.x"
            y="50"
            text-anchor="middle"
          >
            {{
              amounts[i] === null
                ? ""
                : `${formatAmount(amounts[i]!)} ${data.unit}`
            }}
          </text>
        </g>
        <template v-if="moving">
          <circle
            v-if="motion.lossPhase && step.loss"
            class="loss-dot"
            :cx="data.nodes[step.loss.at].x"
            :cy="128 + 58 * motion.t"
            r="6"
            :opacity="1 - motion.t * 0.6"
          />
          <circle
            v-else-if="step.kind === 'transfer'"
            class="transfer-dot"
            :cx="transferX"
            cy="95"
            r="7"
          />
          <circle
            v-else
            class="pulse"
            :cx="data.nodes[step.from].x"
            cy="95"
            :r="20 + 58 * motion.t"
            :opacity="1 - motion.t"
          />
        </template>
      </svg>
    </div>
    <div class="step-caption" aria-live="polite" aria-atomic="true">
      <span class="number">{{ String(index + 1).padStart(2, "0") }}</span>
      <div>
        <h3>{{ step.title }}</h3>
        <div class="state">{{ step.state }}</div>
        <p>{{ step.text }}</p>
      </div>
    </div>
    <div class="budget">
      <div class="budget-label">
        <span>样品去向（{{ data.input }} {{ data.unit }}）</span
        ><span>剩余 {{ formatAmount(remaining) }} {{ data.unit }}</span>
      </div>
      <div
        class="bar"
        role="img"
        :aria-label="`剩余 ${formatAmount(remaining)} ${data.unit}`"
      >
        <span
          class="remaining"
          :style="{ width: `${(remaining / data.input) * 100}%` }"
        />
        <span
          v-for="(loss, i) in losses"
          :key="i"
          :class="`loss-${i}`"
          :style="{ width: `${((loss?.amount ?? 0) / data.input) * 100}%` }"
        />
      </div>
    </div>
    <table class="trace">
      <thead>
        <tr>
          <th scope="col"><span class="visually-hidden">步骤</span></th>
          <th scope="col">事件</th>
          <th scope="col" class="destination">去向</th>
          <th scope="col">剩余</th>
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
          <td>{{ item.title }}</td>
          <td class="destination">{{ item.destination }}</td>
          <td class="quantity">
            {{ formatAmount(item.remaining) }} {{ data.unit }}
          </td>
        </tr>
      </tbody>
    </table>
    <div class="controls">
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
            : index === steps.length - 1 && complete
              ? '重播'
              : '播放'
        "
        @click="toggle"
      >
        {{
          playing || (running && !complete)
            ? "❚❚ 暂停"
            : index === steps.length - 1 && complete
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
.head h2,
.step-caption h3 {
  margin: 0;
  font-size: var(--text-base);
  font-weight: 600;
  line-height: 1.6;
}
.seg {
  display: inline-flex;
  border: 1px solid var(--rule-strong);
  border-radius: var(--radius);
  overflow: hidden;
}
button {
  font: 500 var(--text-sm) var(--font-sans);
  cursor: pointer;
}
.seg button {
  border: 0;
  background: transparent;
  color: var(--ink-soft);
  padding: var(--space-1) var(--space-3);
}
.seg button + button {
  border-left: 1px solid var(--rule-strong);
}
.seg button[aria-pressed="true"] {
  background: var(--accent);
  color: var(--surface);
}
.stage {
  padding: 0 var(--space-3);
}
svg {
  display: block;
  width: 100%;
  height: auto;
}
.node rect {
  fill: var(--surface);
  stroke: var(--rule-strong);
  stroke-width: 1.2;
  transition:
    fill var(--duration) var(--ease),
    stroke var(--duration) var(--ease);
}
.node.active rect {
  fill: var(--accent-soft);
  stroke: var(--accent);
  stroke-width: 2;
}
.name {
  font: 500 var(--text-sm) var(--font-sans);
  fill: var(--ink);
}
.sub,
.edge-label {
  font: 500 var(--text-xs) var(--font-sans);
  fill: var(--ink-muted);
}
.amount {
  font: 500 var(--text-sm) var(--font-mono);
  fill: var(--accent);
}
.amount.dim {
  fill: var(--ink-muted);
}
.edge {
  stroke: var(--rule-strong);
  stroke-width: 1.5;
}
.active .edge {
  stroke: var(--accent);
  stroke-width: 2;
}
.active .edge-label {
  fill: var(--accent);
}
.loss {
  opacity: 0;
  transition: opacity var(--duration) var(--ease);
}
.loss.on {
  opacity: 1;
}
.loss path {
  stroke: var(--danger);
  stroke-width: 1.5;
  stroke-dasharray: 4 4;
  fill: none;
}
.loss text {
  font: 500 var(--text-xs) var(--font-sans);
  fill: var(--danger);
}
.transfer-dot {
  fill: var(--accent);
}
.loss-dot {
  fill: var(--danger);
}
.pulse {
  fill: none;
  stroke: var(--accent);
  stroke-width: 2;
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
.budget {
  margin: 0 var(--space-5) var(--space-4);
}
.budget-label {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  font-size: var(--text-xs);
  color: var(--ink-muted);
  font-weight: 500;
  margin-bottom: var(--space-1);
}
.bar {
  display: flex;
  height: 14px;
  border-radius: var(--radius-sm);
  overflow: hidden;
  background: var(--paper-deep);
}
.bar span {
  transition: width calc(var(--duration) * 3) var(--ease);
}
.remaining {
  background: var(--accent);
}
.loss-0 {
  background: color-mix(in srgb, var(--danger) 60%, var(--surface));
}
.loss-1 {
  background: color-mix(in srgb, var(--danger) 80%, var(--surface));
}
.loss-2 {
  background: var(--danger);
}
.trace {
  width: 100%;
  border-collapse: collapse;
  border-top: 1px solid var(--rule);
  font-size: var(--text-sm);
}
th {
  font-weight: 500;
  color: var(--ink-muted);
  text-align: left;
  font-size: var(--text-xs);
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
.quantity {
  font-family: var(--font-mono);
  white-space: nowrap;
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
  .destination {
    display: none;
  }
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
