<script setup lang="ts">
import { computed, ref } from "vue";
import { Formula, LineChart, PageHeading } from "@ui";

const slope = ref(2);
const points = computed(() =>
  Array.from({ length: 11 }, (_, x) => ({ x, y: slope.value * x })),
);
</script>

<template>
  <article class="page-reading">
    <PageHeading
      eyebrow="Curves"
      title="公式与曲线"
      summary="参数模拟先确定计算函数和单位，再把结果交给公式和曲线组件。"
    />
    <div class="prose">
      <div class="field">
        <label for="slope">斜率 k：{{ slope }}</label>
        <input id="slope" v-model.number="slope" type="range" min="1" max="5" />
      </div>
      <Formula :tex="`y = ${slope}x`" />
      <figure>
        <LineChart :points="points" x-label="x" y-label="y" />
        <figcaption>图 1　y 随 x 线性变化，斜率由上方滑块决定。</figcaption>
      </figure>
    </div>
  </article>
</template>
