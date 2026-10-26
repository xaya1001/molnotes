<script setup lang="ts" generic="E extends StructureEntry">
import { computed, nextTick, onUnmounted, ref, watch } from "vue";
import type { AtomSelectionSpec, AtomSpec, GLViewer } from "3dmol";
import {
  keptRanges,
  structureColorWords,
  presetDistances,
  residueTag,
  type MeasuredPreset,
  type StructureColor,
  type StructureEntry,
  type StructureLayer,
  type StructureSet,
} from "./model";
import {
  distanceBetween,
  findAtom,
  parsePdb,
  type AtomRef,
  type PdbAtom,
} from "./pdb";

/**
 * Real coordinates from a committed subset of a PDB entry, drawn with 3Dmol.js
 * for rotating and picking. The preset list measures the contacts the page
 * talks about; the reader can also click two atoms. Every distance is computed
 * from the coordinate file, also when WebGL is missing. When the answer may
 * not show yet, the caller renders the lab inside its own gate.
 */
const props = defineProps<{
  set: StructureSet<E>;
  /** Entries to offer, in this order; all of them when omitted. */
  ids?: readonly string[];
}>();
defineSlots<{
  /** Page-specific readout under the preset list, once the coordinates are loaded. */
  readout?(props: { entry: E; atoms: readonly PdbAtom[] }): unknown;
}>();

const entries = computed(() =>
  props.ids
    ? props.ids.map((id) => props.set.entryById(id))
    : props.set.entries,
);
const active = ref(entries.value[0].id);
const entry = computed(() => props.set.entryById(active.value));

const text = ref("");
const loadError = ref("");
const atoms = ref<PdbAtom[]>([]);
const presets = ref<MeasuredPreset[]>([]);
const labelTags = ref<string[]>([]);
async function loadCoordinates() {
  const current = entry.value;
  text.value = "";
  atoms.value = [];
  presets.value = [];
  labelTags.value = [];
  loadError.value = "";
  try {
    const response = await fetch(current.url);
    if (!response.ok) throw new Error("坐标文件无法加载");
    const body = await response.text();
    const parsed = parsePdb(body);
    const measured = presetDistances(current, parsed);
    const tags = (current.labels?.resi ?? []).map((resi) =>
      residueTag(parsed, current.labels!.chain, resi),
    );
    if (current.id !== active.value) return;
    text.value = body;
    atoms.value = parsed;
    presets.value = measured;
    labelTags.value = tags;
  } catch (reason) {
    loadError.value =
      reason instanceof Error ? reason.message : "坐标文件无法读取";
  }
}

interface Measurement {
  id: string;
  label: string;
  a: AtomRef;
  b: AtomRef;
  value: number;
}
const drawn = ref<Measurement[]>([]);
const picking = ref<PdbAtom | null>(null);
const name = (a: AtomRef | PdbAtom) => {
  const found = atoms.value.find(
    (x) => x.chain === a.chain && x.resi === a.resi,
  );
  return `${found?.resn ?? ""}${a.resi} ${"atom" in a ? a.atom : ""}`;
};

const container = ref<HTMLElement | null>(null);
const status = ref<"idle" | "loading" | "ready" | "error">("idle");
let viewer: GLViewer | undefined;
let residueLabels: ReturnType<GLViewer["addResLabels"]> = [];
let disposed = false;
const showLabels = ref(true);

function xyz(a: PdbAtom) {
  return { x: a.x, y: a.y, z: a.z };
}
function drawLine(a: PdbAtom, b: PdbAtom, value: number, render = true) {
  if (!viewer) return;
  viewer.addCylinder({
    start: xyz(a),
    end: xyz(b),
    radius: 0.07,
    dashed: true,
    dashLength: 0.3,
    gapLength: 0.2,
    color: "black",
    fromCap: 1,
    toCap: 1,
  });
  viewer.addLabel(`${value.toFixed(2)} Å`, {
    position: {
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
      z: (a.z + b.z) / 2,
    },
    backgroundColor: "white",
    backgroundOpacity: 0.85,
    fontColor: "black",
    fontSize: 12,
    borderThickness: 0,
  });
  if (render) viewer.render();
}
function emphasise(refs: AtomRef[]) {
  if (!viewer) return;
  const { ligand } = entry.value;
  for (const r of refs) {
    if (ligand && r.chain === ligand.chain && r.resi === ligand.resi) continue;
    viewer.addStyle(
      { chain: r.chain, resi: r.resi },
      { stick: { colorscheme: "orangeCarbon", radius: 0.18 } },
    );
  }
}
function measure(m: Measurement) {
  if (!atoms.value.length) return;
  const a = findAtom(atoms.value, m.a);
  const b = findAtom(atoms.value, m.b);
  if (!drawn.value.some((d) => d.id === m.id)) {
    drawn.value.push(m);
    drawLine(a, b, m.value, false);
    emphasise([m.a, m.b]);
  }
  viewer?.zoomTo({
    or: [
      { chain: a.chain, resi: a.resi },
      { chain: b.chain, resi: b.resi },
    ],
  });
  viewer?.render();
}
function pick(spec: AtomSpec) {
  const found = atoms.value.find(
    (x) =>
      x.chain === spec.chain && x.resi === spec.resi && x.atom === spec.atom,
  );
  if (!found) return;
  if (!picking.value) {
    picking.value = found;
    return;
  }
  const first = picking.value;
  picking.value = null;
  if (first === found) return;
  const value = distanceBetween(first, found);
  drawn.value.push({
    id: `free-${drawn.value.length}`,
    label: `${name(first)} … ${name(found)}`,
    a: first,
    b: found,
    value,
  });
  drawLine(first, found, value);
}
function clear() {
  drawn.value = [];
  picking.value = null;
  viewer?.removeAllShapes();
  viewer?.removeAllLabels();
  residueLabels = [];
  applyStyle();
  setResidueLabels();
}
function resize() {
  viewer?.resize();
}

// 3Dmol names for the palette. Cartoons and spheres take a colour; sticks take
// a carbon scheme so the heteroatoms keep their element colours.
const solid: Record<StructureColor, string> = {
  grey: "gray",
  blue: "steelblue",
  cyan: "darkcyan",
  green: "seagreen",
  orange: "darkorange",
  magenta: "mediumvioletred",
  yellow: "goldenrod",
};
const carbon: Record<StructureColor, string> = {
  grey: "whiteCarbon",
  blue: "blueCarbon",
  cyan: "cyanCarbon",
  green: "greenCarbon",
  orange: "orangeCarbon",
  magenta: "magentaCarbon",
  yellow: "yellowCarbon",
};
function selection(layer: StructureLayer): AtomSelectionSpec {
  const { chain, resi, elem } = layer.select;
  // defineStructureSet has checked every number and range
  return {
    chain,
    elem,
    resi: resi as AtomSelectionSpec["resi"],
  };
}
function layerStyle(layer: StructureLayer) {
  const color = layer.color as StructureColor;
  if (layer.style === "cartoon")
    return {
      cartoon: {
        color: color === "grey" ? "lightgrey" : solid[color],
        opacity: layer.opacity ?? 0.8,
      },
    };
  if (layer.style === "stick")
    return {
      stick: { colorscheme: carbon[color], radius: layer.radius ?? 0.14 },
    };
  return { sphere: { color: solid[color], radius: layer.radius ?? 0.9 } };
}
function applyStyle() {
  if (!viewer) return;
  viewer.setStyle({}, {});
  viewer.removeAllSurfaces();
  for (const layer of entry.value.layers)
    if (layer.style === "surface")
      // A van der Waals surface over the selection; `opacity` defaults to half.
      viewer.addSurface(
        "VDW",
        {
          opacity: layer.opacity ?? 0.5,
          color: solid[layer.color as StructureColor],
        },
        selection(layer),
      );
    else viewer.addStyle(selection(layer), layerStyle(layer));
  viewer.setClickable({}, true, pick);
  viewer.render();
}
function setResidueLabels() {
  if (!viewer) return;
  for (const label of residueLabels) viewer.removeLabel(label);
  const { labels } = entry.value;
  residueLabels =
    showLabels.value && labels
      ? viewer.addResLabels(
          { chain: labels.chain, resi: [...labels.resi] },
          { fontSize: 11, fontColor: "black", backgroundOpacity: 0.6 },
        )
      : [];
  viewer.render();
}
async function load() {
  if (!container.value || status.value !== "idle" || !text.value) return;
  status.value = "loading";
  try {
    await nextTick();
    const mol = await import("3dmol");
    if (disposed || !container.value) return;
    viewer = mol.createViewer(container.value, { backgroundColor: "white" });
    viewer.addModel(text.value, "pdb");
    applyStyle();
    setResidueLabels();
    const { ligand, focus } = entry.value;
    viewer.zoomTo(
      focus
        ? {
            chain: focus.chain,
            elem: focus.elem,
            resi: focus.resi
              ? ([...focus.resi] as AtomSelectionSpec["resi"])
              : undefined,
          }
        : ligand
          ? { chain: ligand.chain, resi: ligand.resi }
          : {},
    );
    viewer.zoom(0.85);
    viewer.render();
    window.addEventListener("resize", resize);
    status.value = "ready";
  } catch {
    if (!disposed) status.value = "error";
  }
}
function dispose() {
  if (container.value) container.value.innerHTML = "";
  viewer?.clear();
  viewer = undefined;
  residueLabels = [];
  status.value = "idle";
  drawn.value = [];
  picking.value = null;
}
watch(active, async () => {
  const wasReady = status.value === "ready";
  dispose();
  await loadCoordinates();
  if (wasReady) await load();
});
watch(showLabels, setResidueLabels);
loadCoordinates();
onUnmounted(() => {
  disposed = true;
  window.removeEventListener("resize", resize);
  viewer?.clear();
});

const subsetNote = computed(() => {
  const { subset, ligand } = entry.value;
  const chains = keptRanges(subset)
    .map(([chain, [first, last]]) => `链 ${chain} 的 ${first}–${last}`)
    .join("、");
  const others = subset.hetero
    .filter(
      (h) => !(ligand && h.chain === ligand.chain && h.resi === ligand.resi),
    )
    .map((h) => h.name ?? h.resn);
  const groups = [
    ligand && `配体 ${ligand.resn}（${ligand.name}）`,
    others.join("和"),
  ].filter(Boolean);
  return `${chains}${groups.length ? `，${groups.join("，")}` : ""}；没有氢原子和水。`;
});
const legend = computed(() =>
  entry.value.layers
    .filter((layer) => layer.label)
    .map(
      (layer) =>
        `${layer.style === "sphere" ? "球" : structureColorWords[layer.color as StructureColor]}：${layer.label}`,
    )
    .join("；"),
);
</script>
<template>
  <section class="lab" aria-label="三维结构">
    <h3>三维结构：真实坐标，用来量</h3>
    <fieldset v-if="entries.length > 1" class="tabs">
      <legend>结构</legend>
      <label v-for="item in entries" :key="item.id">
        <input v-model="active" type="radio" :value="item.id" />
        {{ item.label }}
      </label>
    </fieldset>
    <p>
      <a
        :href="`https://www.rcsb.org/structure/${entry.source.pdb}`"
        target="_blank"
        rel="noopener noreferrer"
        >RCSB PDB {{ entry.source.pdb }}</a
      >：{{ entry.source.title
      }}<template v-if="entry.source.resolution"
        >，{{ entry.source.resolution }} Å</template
      >，{{ entry.source.method ?? "X 射线" }}。取了{{ subsetNote }}
      <template v-if="entry.source.note">{{ entry.source.note }}。</template>
      坐标取自 RCSB，{{ set.fetchedOn }}。
    </p>
    <p v-if="loadError" class="callout callout--caution" role="alert">
      {{ loadError }}
      <button class="button" type="button" @click="loadCoordinates()">
        重新加载坐标
      </button>
    </p>
    <h4 v-if="presets.length">先量这几处</h4>
    <ul class="presets">
      <li v-for="p in presets" :key="p.id">
        <button class="button" type="button" @click="measure(p)">
          <span class="num">{{ p.value.toFixed(2) }} Å</span>
          {{ p.label }}
        </button>
      </li>
    </ul>
    <slot v-if="atoms.length" name="readout" :entry="entry" :atoms="atoms" />
    <button
      v-if="status === 'idle'"
      class="button button--primary"
      type="button"
      :disabled="!text"
      @click="load"
    >
      加载三维结构
    </button>
    <p v-if="status === 'loading'" role="status">正在加载结构…</p>
    <p v-if="status === 'error'" class="callout callout--caution" role="alert">
      当前浏览器无法显示三维结构。上面的距离仍由坐标文件算出，可在 RCSB
      查看原结构。
    </p>
    <div
      v-show="status === 'loading' || status === 'ready'"
      ref="container"
      class="canvas"
      :aria-label="`${entry.source.pdb} 三维结构，可拖动旋转`"
    ></div>
    <template v-if="status === 'ready'">
      <p class="caption">
        拖动旋转，滚轮或双指缩放。<template v-if="legend"
          >{{ legend }}。</template
        >点一个原子，再点另一个，量它们的距离。
      </p>
      <p v-if="picking" role="status">
        已选 {{ name(picking) }}，再点第二个原子。
      </p>
      <div class="controls">
        <label v-if="labelTags.length"
          ><input v-model="showLabels" type="checkbox" /> 标出
          {{ labelTags.join(" / ") }}</label
        >
        <button class="button button--quiet" type="button" @click="clear">
          清除测量
        </button>
      </div>
    </template>
    <ul v-if="drawn.length" class="drawn" aria-label="已量的距离">
      <li v-for="m in drawn" :key="m.id">
        {{ m.label }}：<strong class="num">{{ m.value.toFixed(2) }} Å</strong>
      </li>
    </ul>
  </section>
</template>
<style scoped>
.lab > * + * {
  margin-top: var(--space-3);
}
.tabs {
  border: 0;
  padding: 0;
  font-family: var(--font-sans);
}
.tabs label {
  display: inline-block;
  margin-right: var(--space-4);
}
.presets {
  list-style: none;
  padding: 0;
  display: grid;
  gap: var(--space-2);
}
.presets .button {
  text-align: left;
  width: 100%;
}
.num {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  margin-right: var(--space-2);
}
.canvas {
  position: relative;
  width: 100%;
  height: 26rem;
  overflow: hidden;
  border: 1px solid var(--rule);
  border-radius: var(--radius);
  background: #fff;
}
.controls {
  display: flex;
  gap: var(--space-4);
  align-items: center;
  flex-wrap: wrap;
  font-family: var(--font-sans);
}
.drawn {
  font-family: var(--font-sans);
  font-size: var(--text-sm);
}
</style>
