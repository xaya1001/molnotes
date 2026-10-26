<script setup lang="ts">
import { reactive } from "vue";
import { PageHeading, PredictionMatrix, defineMatrix } from "@ui";

// Invented experiments: three samples against three reagents. The quotes are
// placeholders, not text from any publication.
const quote = (sample: string, reagent: string, word: string) => ({
  source: "演示",
  locator: "演示表 1，第 1 页",
  quote: `${sample} with ${reagent}: ${word}.`,
});
const model = defineMatrix({
  rows: [
    { id: "a", label: "样品 A", smiles: "CCO" },
    { id: "b", label: "样品 B", smiles: "CC=O" },
    { id: "c", label: "样品 C", smiles: "CC(C)=O" },
  ],
  columns: [
    { id: "x", label: "试剂 X", full: "演示用试剂 X" },
    { id: "y", label: "试剂 Y", full: "演示用试剂 Y" },
    { id: "z", label: "试剂 Z", full: "演示用试剂 Z" },
  ],
  outcomes: [
    { id: "turns", label: "变色", tone: "success" },
    { id: "stays", label: "不变", tone: "accent" },
    {
      id: "untested",
      label: "未测",
      choiceLabel: "没有做过",
      tone: "untested",
    },
    { id: "plot", label: "仅见于图", tone: "evidence" },
  ],
  choices: ["turns", "stays", "untested"],
  required: ["a:x", "b:y", "c:z"],
  cells: [
    {
      row: "a",
      column: "x",
      outcome: "turns",
      scope: "水溶液",
      system: "室温，10 分钟",
      evidence: [quote("A", "X", "turned blue")],
    },
    {
      row: "a",
      column: "y",
      outcome: "stays",
      system: "室温，10 分钟",
      evidence: [quote("A", "Y", "no change")],
    },
    {
      row: "a",
      column: "z",
      outcome: "turns",
      system: "室温，10 分钟",
      evidence: [quote("A", "Z", "turned blue")],
      caveat: "只做了一次，没有重复。",
    },
    {
      row: "b",
      column: "x",
      outcome: "turns",
      system: "室温，10 分钟",
      evidence: [quote("B", "X", "turned blue")],
    },
    {
      row: "b",
      column: "y",
      outcome: "stays",
      system: "室温，10 分钟",
      evidence: [quote("B", "Y", "no change")],
    },
    {
      row: "b",
      column: "z",
      outcome: "plot",
      evidence: [{ source: "演示", locator: "演示图 2，第 2 页" }],
      gap: "图里画了这一组，正文没有写结论。",
    },
    {
      row: "c",
      column: "x",
      outcome: "stays",
      system: "室温，10 分钟",
      evidence: [quote("C", "X", "no change")],
    },
    {
      row: "c",
      column: "y",
      outcome: "turns",
      system: "室温，10 分钟",
      evidence: [quote("C", "Y", "turned blue")],
    },
    {
      row: "c",
      column: "z",
      outcome: "untested",
      gap: "演示数据里没有做这一组。",
      evidence: [],
    },
  ],
});
// The page keeps the answers; here only in memory.
const answers = reactive<Record<string, number>>({});
</script>

<template>
  <article class="page-reading">
    <PageHeading
      eyebrow="Matrix"
      title="预测矩阵"
      summary="先猜几个格子，全部答完才看到整张矩阵和每格的出处。"
    />
    <div class="prose">
      <p>
        演示数据，实验是虚构的。组件不保存作答：选择通过事件交给页面，下面的作答只存在内存里，刷新后清空。
      </p>
      <PredictionMatrix
        :model="model"
        :answers="answers"
        question="{row} 加 {column} 会变色吗？"
        instruction="按演示表回答。表里没有做的，选“没有做过”。"
        label="演示矩阵"
        caption="行是样品，列是试剂；每格是演示表里的结果"
        row-header="样品"
        @answer="(id, pick) => (answers[id] = pick)"
        @reset="(id) => delete answers[id]"
      />
    </div>
  </article>
</template>
