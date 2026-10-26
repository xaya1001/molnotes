<script setup lang="ts">
import { DataScatterExplorer, PageHeading, defineDataTable } from "@ui";

// Invented numbers for eight simple molecules; they only show how the
// controls behave. Activities are printed in µM and shown in nM.
const potency = (key: string, label: string) => ({
  key,
  label,
  unit: "nM",
  sourceUnit: "µM",
  shift: 3,
  scale: "log" as const,
});
const table = defineDataTable({
  columns: [
    potency("a", "演示活性 A"),
    potency("b", "演示活性 B"),
    {
      key: "delta",
      label: "演示位移 Δ",
      unit: "℃",
      sourceUnit: "℃",
      scale: "linear",
    },
  ],
  groups: {
    label: "官能团",
    items: [
      { id: "alcohol", label: "醇与酚", where: "演示分组 1" },
      { id: "carbonyl", label: "羰基与羧酸", where: "演示分组 2" },
      { id: "other", label: "其他", where: "演示分组 3" },
    ],
  },
  alternates: {
    source: "第二张表",
    listed: "第一张表的值",
    alternate: "第二张表的值",
    legend: "两张表写得不一样的格子，散点取",
  },
  rows: [
    {
      id: "ethanol",
      label: "乙醇",
      smiles: "CCO",
      group: "alcohol",
      values: {
        a: { raw: "0.012", sd: "0.002" },
        b: { raw: "0.5" },
        delta: { raw: "1.5" },
      },
    },
    {
      id: "propanol",
      label: "丙醇",
      smiles: "CCCO",
      group: "alcohol",
      values: {
        a: { raw: "0.0085" },
        b: { raw: "0.31" },
        delta: { raw: "2" },
      },
    },
    {
      id: "phenol",
      label: "苯酚",
      smiles: "Oc1ccccc1",
      group: "alcohol",
      values: {
        a: { raw: ">10" },
        b: { raw: "2.4" },
        delta: { raw: "-0.5" },
      },
    },
    {
      id: "acetic-acid",
      label: "乙酸",
      smiles: "CC(=O)O",
      group: "carbonyl",
      values: {
        a: { raw: "0.45" },
        b: { raw: "<0.05" },
        delta: { raw: "-2.5" },
      },
    },
    {
      id: "acetone",
      label: "丙酮",
      smiles: "CC(C)=O",
      group: "carbonyl",
      notes: ["演示备注：丙酮的活性 B 在两张表里差了 10 倍。"],
      values: {
        a: { raw: "0.033" },
        b: {
          raw: "1.1",
          alternate: {
            raw: "110",
            unit: "nM",
            where: "演示表 B",
            note: "第一张表写 1.1 µM，第二张表写 110 nM。",
          },
        },
        delta: { raw: "0.8" },
      },
    },
    {
      id: "acetaldehyde",
      label: "乙醛",
      smiles: "CC=O",
      group: "carbonyl",
      values: { a: { raw: "0.2" }, delta: { raw: "3.5" } },
    },
    {
      id: "ether",
      label: "乙醚",
      smiles: "CCOCC",
      group: "other",
      values: { a: { raw: "3.2" }, b: { raw: "9.8" } },
    },
    {
      id: "benzene",
      label: "苯",
      smiles: "c1ccccc1",
      group: "other",
      values: {
        a: {
          raw: "0.0009",
          alternate: { raw: "1.4", unit: "nM", where: "演示表 B" },
        },
        b: { raw: "0.07" },
        delta: { raw: "4.5" },
      },
    },
  ],
});
</script>

<template>
  <article class="page-wide">
    <PageHeading
      eyebrow="Data"
      title="数据表与散点"
      summary="数值按来源的写法保存，界限值保持界限，缺测不当成零，两处写法不一致的格子并排显示。"
    />
    <div class="prose">
      <DataScatterExplorer
        :table="table"
        title="8 个样品"
        label="8 个样品的数据探索"
        noun="样品"
        id-label="名称"
        default-x="a"
        default-y="delta"
      >
        <p class="caption">
          演示数据，数值是虚构的。活性按 µM 记录，表中换算成 nM；带 &gt; 或 &lt;
          的值是界限，不是确切值；乙醛的活性 B
          和乙醚的位移没有数据，显示为“未测”，不进散点。
        </p>
      </DataScatterExplorer>
    </div>
  </article>
</template>
