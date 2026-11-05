<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId } from "vue";
import {
  formatAmount,
  type ProcessData,
  type ProcessStep,
} from "../../../shared/process.ts";
import { processAmounts, processLosses } from "./process-state.ts";
const props = defineProps<{
  data: ProcessData;
  steps: ProcessStep[];
  index: number;
  progress: number;
  reduced: boolean;
}>();
const arrowId = useId();
const stage = ref<HTMLElement | null>(null);
const containerWidth = ref(680);
let observer: ResizeObserver;
let resizeFrame = 0;
const vertical = computed(() => containerWidth.value < 600);
const diagramWidth = computed(() => containerWidth.value);
const hasLoss = computed(() =>
  props.data.scenarios.some((scenario) =>
    scenario.steps.some((step) => step.loss),
  ),
);
const diagramHeight = computed(() =>
  vertical.value ? props.data.nodes.length * 160 : hasLoss.value ? 250 : 160,
);
const nodeHalfWidth = computed(() =>
  vertical.value ? Math.min(70, diagramWidth.value * 0.21) : 60,
);
const nodes = computed(() =>
  props.data.nodes.map((node, i) => ({
    ...node,
    x: vertical.value
      ? diagramWidth.value * (hasLoss.value ? 0.27 : 0.5)
      : (diagramWidth.value / props.data.nodes.length) * (i + 0.5),
    y: vertical.value ? 68 + i * 160 : hasLoss.value ? 95 : 80,
  })),
);
const edges = computed(() => {
  const result: { from: number; to: number }[] = [];
  for (const scenario of props.data.scenarios)
    for (const step of scenario.steps) {
      if (
        (step.kind === "transfer" || step.kind === "blocked") &&
        !result.some((e) => e.from === step.from && e.to === step.to)
      )
        result.push({ from: step.from, to: step.to });
    }
  return result.map((edge) => {
    const from = nodes.value[edge.from],
      to = nodes.value[edge.to];
    const direction = Math.sign(edge.to - edge.from);
    return {
      ...edge,
      x1: vertical.value ? from.x : from.x + nodeHalfWidth.value * direction,
      y1: vertical.value ? from.y + 33 * direction : from.y,
      x2: vertical.value ? to.x : to.x - (nodeHalfWidth.value + 2) * direction,
      y2: vertical.value ? to.y - 35 * direction : to.y,
      labelX: vertical.value ? from.x + 14 : (from.x + to.x) / 2,
      labelY: vertical.value ? (from.y + to.y) / 2 + 5 : from.y - 12,
      label: props.steps.find((s) => s.from === edge.from && s.to === edge.to)
        ?.label,
    };
  });
});
const branches = computed(() => {
  const result: { node: number; label: string }[] = [];
  for (const scenario of props.data.scenarios)
    for (const step of scenario.steps) {
      if (
        step.loss &&
        !result.some(
          (b) => b.node === step.loss!.node && b.label === step.loss!.label,
        )
      )
        result.push(step.loss);
    }
  return result.map((branch) => {
    const node = nodes.value[branch.node];
    return {
      ...branch,
      x1: vertical.value ? node.x + nodeHalfWidth.value : node.x,
      y1: vertical.value ? node.y : node.y + 33,
      x2: vertical.value ? diagramWidth.value * 0.77 - 50 : node.x,
      y2: vertical.value ? node.y : node.y + 91,
      labelX: vertical.value ? diagramWidth.value * 0.77 : node.x,
      labelY: vertical.value ? node.y - 5 : node.y + 111,
    };
  });
});
const step = computed(() => props.steps[props.index]);
const complete = computed(() => props.progress >= 1);
const moving = computed(() => !props.reduced && !complete.value);
const amounts = computed(() =>
  processAmounts(props.data, props.steps, props.index, props.progress),
);
const losses = computed(() => {
  const shown = processLosses(props.steps, props.index, props.progress);
  return branches.value.map((branch) => {
    const matches = shown.filter(
      (loss) => loss.node === branch.node && loss.label === branch.label,
    );
    return matches.length
      ? { amount: matches.reduce((sum, loss) => sum + (loss.amount ?? 0), 0) }
      : undefined;
  });
});
const activeBranch = computed(() =>
  branches.value.findIndex(
    (branch) =>
      branch.node === step.value.loss?.node &&
      branch.label === step.value.loss?.label,
  ),
);
const motion = computed(() => {
  const split =
    step.value.loss && step.value.kind !== "exit"
      ? 0.6
      : step.value.kind === "exit"
        ? 0
        : 1;
  const lossPhase = split === 0 || (split < 1 && props.progress >= split);
  const raw = lossPhase
    ? (props.progress - split) / (1 - split)
    : props.progress / split;
  return {
    lossPhase,
    t: raw < 0.5 ? 2 * raw * raw : 1 - Math.pow(-2 * raw + 2, 2) / 2,
  };
});
const transferPoint = computed(() => {
  const edge = edges.value.find(
    (edge) => edge.from === step.value.from && edge.to === step.value.to,
  )!;
  const t = motion.value.t * (step.value.kind === "blocked" ? 0.5 : 1);
  return {
    x: edge.x1 + (edge.x2 - edge.x1) * t,
    y: edge.y1 + (edge.y2 - edge.y1) * t,
  };
});
const cutoffPoint = computed(() => {
  const edge = edges.value.find(
    (edge) => edge.from === step.value.from && edge.to === step.value.to,
  )!;
  return { x: (edge.x1 + edge.x2) / 2, y: (edge.y1 + edge.y2) / 2 };
});
const lossPoint = computed(() => {
  const branch = branches.value[activeBranch.value];
  return {
    x: branch.x1 + (branch.x2 - branch.x1) * motion.value.t,
    y: branch.y1 + (branch.y2 - branch.y1) * motion.value.t,
  };
});
onMounted(() => {
  observer = new ResizeObserver(([entry]) => {
    cancelAnimationFrame(resizeFrame);
    const width = entry.contentRect.width;
    if (width !== containerWidth.value)
      resizeFrame = requestAnimationFrame(() => {
        containerWidth.value = width;
      });
  });
  observer.observe(stage.value!);
});
onBeforeUnmount(() => {
  cancelAnimationFrame(resizeFrame);
  observer.disconnect();
});
</script>
<template>
  <div
    ref="stage"
    class="stage"
    :data-layout="vertical ? 'vertical' : 'horizontal'"
  >
    <svg
      :viewBox="`0 0 ${diagramWidth} ${diagramHeight}`"
      role="img"
      :aria-label="data.label"
    >
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
        v-for="edge in edges"
        :key="`${edge.from}-${edge.to}`"
        :class="{
          active:
            (step.kind === 'transfer' || step.kind === 'blocked') &&
            step.from === edge.from &&
            step.to === edge.to,
        }"
      >
        <line
          class="edge"
          :x1="edge.x1"
          :y1="edge.y1"
          :x2="edge.x2"
          :y2="edge.y2"
          :marker-end="`url(#${arrowId})`"
        />
        <text
          class="edge-label"
          :x="edge.labelX"
          :y="edge.labelY"
          :text-anchor="vertical ? 'start' : 'middle'"
        >
          {{ edge.label }}
        </text>
      </g>
      <g
        v-for="(branch, i) in branches"
        :key="`${branch.node}-${branch.label}`"
        class="loss"
        :class="{
          on: losses[i] || (motion.lossPhase && activeBranch === i),
        }"
      >
        <path
          :d="`M${branches[i].x1} ${branches[i].y1} L${branches[i].x2} ${branches[i].y2}`"
        />
        <text
          v-if="data.total"
          :x="branches[i].labelX"
          :y="branches[i].labelY"
          text-anchor="middle"
        >
          −
          {{
            formatAmount(
              losses[i]?.amount ??
                (activeBranch === i ? (step.loss?.amount ?? 0) : 0),
            )
          }}
          {{ data.total?.unit }}
        </text>
        <text
          :x="branches[i].labelX"
          :y="branches[i].labelY + 18"
          text-anchor="middle"
        >
          {{ branch.label }}
        </text>
      </g>
      <g
        v-for="(node, i) in nodes"
        :key="node.name"
        class="node"
        :class="{
          active: i === step.from || (step.kind !== 'blocked' && i === step.to),
        }"
      >
        <rect
          :x="node.x - nodeHalfWidth"
          :y="node.y - 33"
          :width="nodeHalfWidth * 2"
          height="66"
          rx="8"
        />
        <text class="name" :x="node.x" :y="node.y - 4" text-anchor="middle">
          {{ node.name }}
        </text>
        <text class="sub" :x="node.x" :y="node.y + 17" text-anchor="middle">
          {{ node.detail }}
        </text>
        <text
          v-if="data.total"
          class="amount"
          :class="{ dim: amounts[i] === 0 }"
          :x="vertical ? node.x - nodeHalfWidth : node.x"
          :y="node.y - 45"
          :text-anchor="vertical ? 'start' : 'middle'"
        >
          {{
            amounts[i] === null
              ? ""
              : `${formatAmount(amounts[i]!)} ${data.total?.unit}`
          }}
        </text>
      </g>
      <template v-if="moving">
        <circle
          v-if="motion.lossPhase && step.loss"
          class="loss-dot"
          :cx="lossPoint.x"
          :cy="lossPoint.y"
          r="6"
          :opacity="1 - motion.t * 0.6"
        />
        <circle
          v-else-if="step.kind === 'transfer' || step.kind === 'blocked'"
          class="transfer-dot"
          :cx="transferPoint.x"
          :cy="transferPoint.y"
          r="7"
        />
        <circle
          v-else
          class="pulse"
          :cx="nodes[step.from].x"
          :cy="nodes[step.from].y"
          :r="20 + 58 * motion.t"
          :opacity="1 - motion.t"
        />
      </template>
      <g v-if="step.kind === 'blocked'" class="cutoff">
        <path
          :d="`M${cutoffPoint.x - 7} ${cutoffPoint.y - 8} l14 16 m0 -16 l-14 16`"
        />
        <circle
          v-if="!moving"
          :cx="transferPoint.x"
          :cy="transferPoint.y"
          r="6"
        />
      </g>
    </svg>
  </div>
</template>
<style scoped>
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
  font: 500 var(--text-sm) var(--font-sans);
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
  font: 500 var(--text-sm) var(--font-sans);
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
.cutoff path {
  stroke: var(--danger);
  stroke-width: 3;
}
.cutoff circle {
  fill: var(--danger);
}
@media (prefers-reduced-motion: reduce) {
  * {
    transition: none !important;
  }
}
</style>
