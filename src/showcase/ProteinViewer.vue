<script setup lang="ts">
import { nextTick, onUnmounted, ref } from "vue";
import type { GLViewer } from "3dmol";

const container = ref<HTMLElement | null>(null);
const status = ref<"idle" | "loading" | "ready" | "error">("idle");
let viewer: GLViewer | undefined;

function resize() {
  viewer?.resize();
}

async function loadStructure() {
  if (!container.value || status.value !== "idle") return;
  status.value = "loading";
  try {
    await nextTick();
    const [mol, response] = await Promise.all([
      import("3dmol"),
      fetch("/showcase/1crn.pdb"),
    ]);
    if (!response.ok) throw new Error("结构文件无法加载");
    viewer = mol.createViewer(container.value, { backgroundColor: "white" });
    viewer.addModel(await response.text(), "pdb");
    viewer.setStyle({ chain: "A" }, { cartoon: { color: "spectrum" } });
    viewer.zoomTo();
    viewer.render();
    window.addEventListener("resize", resize);
    status.value = "ready";
  } catch {
    status.value = "error";
  }
}

onUnmounted(() => window.removeEventListener("resize", resize));
</script>

<template>
  <div class="structure-demo">
    <p>
      RCSB PDB <a href="https://www.rcsb.org/structure/1CRN">1CRN</a>：Crambin
      的 X 射线结构。仅展示 A 链 cartoon，用于演示旋转与缩放。
    </p>
    <button
      v-if="status === 'idle'"
      class="button"
      type="button"
      @click="loadStructure"
    >
      加载三维结构
    </button>
    <p v-if="status === 'loading'">正在加载结构…</p>
    <p v-if="status === 'error'" class="callout callout--caution" role="alert">
      当前浏览器无法显示三维结构，请访问上方来源查看结构详情。
    </p>
    <div
      v-show="status === 'loading' || status === 'ready'"
      ref="container"
      class="structure-canvas"
    ></div>
    <p v-if="status === 'ready'" class="caption">
      结构已加载。拖动旋转，滚轮或双指缩放。
    </p>
  </div>
</template>

<style scoped>
.structure-demo > * + * {
  margin-top: var(--space-4);
}

.structure-canvas {
  position: relative;
  width: 100%;
  height: 22rem;
  overflow: hidden;
  border: 1px solid var(--rule);
  border-radius: var(--radius);
  background: #fff;
}
</style>
