<script setup lang="ts">
import { computed, ref, shallowRef, watch, useId } from "vue";
import StepPlayer from "./StepPlayer.vue";
import MechanismDiagram from "./MechanismDiagram.vue";
import CatalyticCycleView from "./CatalyticCycle.vue";
import SchemeArrow from "./SchemeArrow.vue";
import ReactionScheme from "./ReactionScheme.vue";
import { loadChemistry } from "./chemistry/rdkit.ts";
import {
  drawMechanismFrame,
  compactCycleFrame,
  type MechanismDrawing,
} from "./chemistry/mechanism-drawing.ts";
import { atomSources, edgeKey } from "../../shared/mechanism-geometry.ts";
import type { MechanismFrame, CatalyticCycle } from "../../shared/mechanism.ts";
import type { ReactionStep } from "../../shared/reaction-scheme.ts";
const props = defineProps<{
  frames: readonly MechanismFrame[];
  cycle?: CatalyticCycle;
  overall?: ReactionStep;
}>();
const steps = computed(() =>
  props.frames.map((f) => ({ title: f.title, text: f.explanation })),
);
const drawings = shallowRef<MechanismDrawing[]>([]),
  cycleDrawings = shallowRef<MechanismDrawing[]>([]);
const branches = shallowRef<MechanismDrawing[][]>([]);
const error = ref(""),
  retry = ref(0),
  detail = ref(false),
  player = ref<InstanceType<typeof StepPlayer>>();
const panel = useId();
watch(
  [() => props.frames, () => props.cycle, retry],
  async (_, __, cleanup) => {
    let active = true;
    cleanup(() => (active = false));
    drawings.value = [];
    error.value = "";
    try {
      const toolkit = await loadChemistry();
      if (!active) return;
      const sources = atomSources(props.frames),
        initialBonds = new Set<string>();
      for (const m of props.frames[0].molecules) {
        const mol = toolkit.get_mol(m.smiles)!;
        try {
          const g = JSON.parse(mol.get_json()).molecules[0];
          for (const b of g.bonds)
            initialBonds.add(
              edgeKey(m.atomMap[b.atoms[0]], m.atomMap[b.atoms[1]]),
            );
        } finally {
          mol.delete();
        }
      }
      drawings.value = props.frames.map((f) =>
        drawMechanismFrame(toolkit, f, sources, initialBonds),
      );
      cycleDrawings.value = props.cycle
        ? props.frames.map((f, i) =>
            drawMechanismFrame(
              toolkit,
              compactCycleFrame(toolkit, f, props.cycle!.intermediates[i]),
              sources,
              initialBonds,
            ),
          )
        : [];
      branches.value = props.cycle
        ? props.cycle.steps.map((step) =>
            (step.branches ?? []).map((b) =>
              drawMechanismFrame(
                toolkit,
                compactCycleFrame(toolkit, props.frames[b.frame], b.molecule),
                sources,
                initialBonds,
              ),
            ),
          )
        : [];
    } catch (e) {
      if (active) error.value = e instanceof Error ? e.message : String(e);
    }
  },
  { immediate: true },
);
function select(i: number) {
  detail.value = true;
  player.value?.go(i);
}
const arrowSteps = computed(() =>
  props.frames.map((f) => ({
    title: f.step?.title ?? f.title ?? "",
    reactants: [],
    products: [],
    reagents: [f.step?.title ?? f.title ?? ""],
    conditions: f.step?.definitions ?? [],
    explanation: f.explanation,
  })),
);
</script>
<template>
  <StepPlayer ref="player" label="分步机理" :steps="steps">
    <template #default="{ index, progress, reduced, started }">
      <div v-if="overall" class="overall-reaction">
        <ReactionScheme
          :route="{ id: 'overall', title: overall.title, steps: [overall] }"
        />
      </div>
      <p v-if="error" role="alert">
        {{ error }} <button type="button" @click="retry++">重试结构加载</button>
      </p>
      <template v-else-if="drawings.length">
        <CatalyticCycleView
          v-if="cycle"
          :cycle="cycle"
          :drawings="cycleDrawings"
          :branches="branches"
          :index="index"
          @select="select"
        />
        <div v-else class="mechanism-overview" aria-label="机理全貌">
          <MechanismDiagram :drawing="drawings[0]" static />
          <div
            v-for="(drawing, i) in drawings.slice(1)"
            :key="i"
            class="mechanism-step"
          >
            <SchemeArrow
              v-if="frames[i].step"
              :step="arrowSteps[i]"
              :equilibrium="frames[i].step?.reversible"
              :selected="detail && index === i"
              :controls="panel"
              @select="select(i)"
            />
            <MechanismDiagram :drawing="drawing" static />
          </div>
        </div>
        <div
          v-if="detail || started"
          :id="panel"
          class="mechanism-detail"
          :data-frame="index"
        >
          <MechanismDiagram
            :drawing="drawings[index]"
            :target="
              frames[index].step
                ? (drawings[index + 1] ?? (cycle ? drawings[0] : undefined))
                : undefined
            "
            :progress="reduced ? 1 : started ? progress : 0"
          />
        </div>
      </template>
    </template>
  </StepPlayer>
</template>
<style scoped>
.overall-reaction {
  border: 1px solid var(--rule-strong);
  margin: var(--space-4);
  padding: var(--space-3);
}
.overall-reaction :deep(.scheme-explanation) {
  display: none;
}
.mechanism-overview {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-4);
}
.mechanism-overview > :first-child {
  max-width: 100%;
  flex: 0 1 auto;
}
.mechanism-step {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
  max-width: 100%;
}
.mechanism-step > :first-child {
  flex-shrink: 0;
  margin-bottom: 0;
}
.mechanism-step > :last-child {
  min-width: 0;
  flex: 0 1 auto;
}
.mechanism-detail {
  padding: var(--space-4);
  border-top: 1px solid var(--rule);
}
@media (max-width: 640px) {
  .mechanism-overview,
  .mechanism-step {
    flex-direction: column;
    align-items: center;
    width: 100%;
  }
  .mechanism-step > :first-child {
    flex-shrink: 1;
  }
}
</style>
