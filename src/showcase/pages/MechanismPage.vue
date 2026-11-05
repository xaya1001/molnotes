<script setup lang="ts">
import MechanismViewer from "../../ui/MechanismViewer.vue";
import {
  substitution,
  addition,
  radical,
  cycleFrames,
  couplingCycle,
  overall,
} from "../data/mechanisms.ts";
</script>
<template>
  <article class="page-wide">
    <h1>机理与催化循环</h1>
    <section aria-label="亲核取代示例">
      <h2>亲核取代与过渡态</h2>
      <MechanismViewer :frames="substitution" :overall="overall" />
    </section>
    <section aria-label="羰基加成示例">
      <h2>羰基加成</h2>
      <MechanismViewer :frames="addition" />
    </section>
    <section aria-label="自由基示例">
      <h2>单电子转移</h2>
      <MechanismViewer :frames="radical" />
    </section>
    <section aria-label="催化循环示例">
      <h2>催化循环</h2>
      <MechanismViewer :frames="cycleFrames" :cycle="couplingCycle" />
    </section>
  </article>
</template>
