<script setup lang="ts">
import { PageHeading } from "@ui";
import FlowFigure from "../../ui/diagrams/FlowFigure.vue";
import TimelineFigure from "../../ui/diagrams/TimelineFigure.vue";
import { defineFlow } from "../../ui/diagrams/flow";
import { defineTimeline } from "../../ui/diagrams/model";

// Neutral samples: the data shapes notes write as YAML and topics as JSON.
const lanes = defineTimeline({
  axis: { from: 2010, to: 2022, every: 2 },
  markers: [{ date: "2014-06", text: "共晶结构发表" }],
  lanes: [
    {
      label: "项目甲",
      spans: [{ from: 2010, to: 2014, text: "四年，筛了三百个类似物" }],
      events: [
        { date: 2010, text: "建立细胞筛选" },
        { date: "2015-03", text: "候选化合物\n进入临床前" },
        { date: "2019-11-20", text: "获批", accent: true },
      ],
    },
    {
      label: "项目乙",
      events: [
        { date: 2012, text: "从文献化合物起步" },
        { between: [2014, 2017], text: "转折：换母核" },
        { date: "2016-09", text: "候选化合物" },
        { date: "2020-02", text: "获批", accent: true },
      ],
    },
  ],
  brackets: [{ from: 2010, to: 2019, text: "九年" }],
});
const even = defineTimeline({
  axis: { even: true },
  events: [
    { date: 1990, text: "第一次观察到现象" },
    { date: "1994-05", show: "1994 年春", text: "小规模验证" },
    { date: 1998, text: "临床试验开始" },
    { date: 2001, text: "改用新的适应症", accent: true },
    { date: 2004, text: "广泛使用" },
  ],
});
// A year by month: dense dates in two lanes, shapes with a legend, an accented marker.
const months = defineTimeline({
  markers: [{ date: "2023-06-15", below: "中期分析", accent: true }],
  lanes: [
    {
      label: "试验甲",
      events: [
        { date: "2023-02-01", mark: "diamond", text: "首例入组" },
        { date: "2023-02-20", text: "第一批数据" },
        { date: "2023-03-05", mark: "ring", text: "方案修订" },
        { date: "2023-09-12", mark: "square", accent: true, text: "达到终点" },
      ],
    },
    {
      label: "试验乙",
      events: [
        { date: "2023-01-10", mark: "diamond", text: "首例入组" },
        { date: "2023-07-01", mark: "ring", text: "暂停入组" },
        { date: "2023-07-20", mark: "ring", text: "恢复入组" },
        { date: "2023-11-30", mark: "square", text: "未达终点" },
      ],
    },
  ],
  legend: [
    { mark: "diamond", text: "开始" },
    { mark: "ring", text: "调整" },
    { mark: "square", text: "结果" },
  ],
});
const flow = defineFlow({
  over: "从取样到回到同一位病人：几个星期",
  nodes: [
    { id: "take", text: "取样", tag: "病人" },
    { id: "split", text: "分离细胞" },
    { id: "change", text: "改造" },
    { id: "grow", text: "体外扩增 9 到 11 天", tone: "accent" },
    { id: "test", text: "检测" },
    { id: "back", text: "回输", tag: "病人" },
    { id: "follow", text: "随访" },
  ],
  edges: [
    "take > split > change > grow > test > back",
    { from: "back", to: "follow", dashed: true },
  ],
  note: "每位病人一批，没有库存",
});
const branching = defineFlow({
  nodes: [
    { id: "start", text: "样品", kind: "end" },
    { id: "a", text: "来源甲" },
    { id: "b", text: "来源乙" },
    { id: "c", text: "来源丙" },
    { id: "pool", text: "合并后复测" },
    { id: "out", text: "剔除干扰", kind: "note", tone: "muted" },
    { id: "ask", text: "活性仍在？", kind: "ask" },
    { id: "keep", text: "进入下一轮", kind: "end", tone: "accent" },
    { id: "drop", text: "放弃", tone: "muted" },
  ],
  edges: [
    "start > a",
    "start > b",
    "start > c",
    { from: ["a", "b", "c"], to: "pool" },
    { from: "pool", to: "out", side: true },
    "pool > ask",
    { from: "ask", to: "keep", text: "是" },
    { from: "ask", to: "drop", text: "否" },
  ],
});
</script>

<template>
  <article class="page-reading">
    <PageHeading
      eyebrow="Diagrams"
      title="时间线与流程"
      summary="按日期比例排开的时间线与分支流程，内容只写数据。"
    />
    <div class="prose">
      <h2>多泳道时间线</h2>
      <TimelineFigure
        class="figure"
        :timeline="lanes"
        caption="两个项目的进度；虚线是两个项目共同的时间点。"
      />
      <h2>等距时间线</h2>
      <TimelineFigure
        class="figure"
        :timeline="even"
        caption="只看先后，不按比例。"
      />
      <h2>按月的时间线</h2>
      <TimelineFigure
        class="figure"
        :timeline="months"
        caption="2023 年两个试验的进度。"
      />
      <h2>流程</h2>
      <FlowFigure class="figure" :flow="flow" caption="一条链走到底。" />
      <h2>汇合、判断与侧出口</h2>
      <FlowFigure
        class="figure"
        :flow="branching"
        caption="三路汇合，复测时剔除一部分，再按判断分开。"
      />
    </div>
  </article>
</template>
