<script setup lang="ts">
import { ref } from "vue";
import {
  PageHeading,
  UiFigure,
  MoleculeView,
  MolecularProperties,
  SubstituentExplorer,
  SynthesisRoute,
  MechanismViewer,
  PredictionExercise,
  SourceExcerpt,
  ReadingGuide,
  type SynthesisRouteData,
  type MechanismFrame,
} from "@ui";
const selected = ref<number[]>([]),
  cut = ref<number[]>([]),
  sar = ref("");
const sources = [{ id: "demo", title: "工具箱中性演示数据" }];
const excerpt = {
  id: "demo-evidence",
  source: "demo",
  locator: "乙醇结构与描述符示例",
  text: "CCO",
  guide: "两个碳连接一个氧。此处只演示数据、结构与导读如何一起呈现。",
};
const routes: SynthesisRouteData[] = [
  {
    id: "oxidation",
    title: "氧化示意",
    steps: [
      {
        title: "乙醇到乙醛",
        reactants: [{ name: "乙醇", smiles: "CCO" }],
        products: [{ name: "乙醛", smiles: "CC=O" }],
        reagents: "氧化剂（示意）",
        conditions: "教学结构对照，无实验条件",
        explanation: "比较羟基与羰基；不是操作规程。",
      },
      {
        title: "乙醛到乙酸",
        reactants: [{ name: "乙醛", smiles: "CC=O" }],
        products: [{ name: "乙酸", smiles: "CC(=O)O" }],
        reagents: "氧化剂（示意）",
        conditions: "教学结构对照，无实验条件",
        explanation: "逐步浏览时同时更换反应物和产物。",
      },
    ],
  },
  {
    id: "acetylation",
    title: "乙酰化示意",
    steps: [
      {
        title: "水杨酸到阿司匹林",
        reactants: [
          { name: "水杨酸", smiles: "OC(=O)c1ccccc1O" },
          { name: "乙酸酐", smiles: "CC(=O)OC(C)=O" },
        ],
        products: [
          { name: "阿司匹林", smiles: "CC(=O)Oc1ccccc1C(=O)O" },
          { name: "乙酸", smiles: "CC(=O)O" },
        ],
        reagents: "乙酸酐（示意）",
        conditions: "教学结构对照，无实验条件",
        explanation: "同一步里大小不同的分子按同一键长绘制，小分子不被放大。",
      },
    ],
  },
  {
    id: "reduction",
    title: "还原示意",
    steps: [
      {
        title: "乙醛到乙醇",
        reactants: [{ name: "乙醛", smiles: "CC=O" }],
        products: [{ name: "乙醇", smiles: "CCO" }],
        reagents: "还原剂（示意）",
        conditions: "教学结构对照，无实验条件",
        explanation: "另一条路线仍由相同的反应结构契约呈现。",
      },
    ],
  },
];
const frames: MechanismFrame[] = [
  {
    name: "羰基的电子对位移",
    smiles: "CC=O",
    arrows: [{ from: { bond: 1 }, to: { atom: 2 }, electrons: 2 }],
    explanation:
      "双钩箭头从 C=O 键指向氧，仅表示羰基 π 电子对位移这一局部步骤。",
  },
  {
    name: "氯分子的均裂",
    smiles: "ClCl",
    arrows: [
      { from: { bond: 0 }, to: { atom: 0 }, electrons: 1 },
      { from: { bond: 0 }, to: { atom: 1 }, electrons: 1 },
    ],
    explanation:
      "两个鱼钩箭头各表示一个电子；此帧独立演示 Cl–Cl 的均裂，不是上一帧的后续反应。",
  },
];
</script>
<template>
  <article class="page-reading">
    <PageHeading
      eyebrow="Molecule"
      title="二维分子结构"
      summary="点选结构、比较性质，再把判断与证据放在一起。"
    />
    <div class="prose">
      <PredictionExercise
        prompt="乙醇中，哪个原子是氧？"
        :can-submit="selected.length > 0"
      >
        <template #default="{ submitted }"
          ><MoleculeView
            name="乙醇"
            smiles="CCO"
            selectable="atoms"
            v-model:selected="selected"
            :disabled="submitted"
            :highlight-atoms="submitted ? [2] : []"
            :labels="submitted ? { 2: '氧' } : {}"
        /></template>
        <template #result
          ><p>
            图中标出的是氧原子；你的选择{{
              selected.includes(2) ? "与之一致" : "不同"
            }}。
          </p>
          <SourceExcerpt :excerpt="excerpt" :sources="sources"
        /></template>
      </PredictionExercise>
      <MolecularProperties smiles="CCO" />
      <h2>立体标记</h2>
      <MoleculeView name="L-乳酸" smiles="C[C@H](O)C(=O)O" />
      <h2>选择断键</h2>
      <PredictionExercise
        prompt="选择乙醇的 C–O 键"
        :can-submit="cut.length > 0"
      >
        <template #default="{ submitted }"
          ><MoleculeView
            name="断键示例"
            smiles="CCO"
            selectable="bonds"
            v-model:selected="cut"
            :disabled="submitted"
            :highlight-bonds="submitted ? [1] : []"
        /></template>
        <template #result
          ><p>
            图中标出的是 C–O 键；你的选择{{
              cut.includes(1) ? "与之一致" : "不同"
            }}。本题演示键选择，不代表合成路线建议。
          </p></template
        >
      </PredictionExercise>
      <h2>表格中的预测</h2>
      <PredictionExercise
        prompt="乙醇换成乙酸，TPSA 会怎样变化？"
        :can-submit="sar !== ''"
      >
        <template #default="{ submitted }"
          ><div class="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>结构对照</th>
                  <th>预测</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>乙醇 → 乙酸</td>
                  <td>
                    <select
                      v-model="sar"
                      aria-label="TPSA 预测"
                      class="input"
                      :disabled="submitted"
                    >
                      <option value="">请选择</option>
                      <option>升高</option>
                      <option>降低</option>
                    </select>
                  </td>
                </tr>
              </tbody>
            </table>
          </div></template
        >
        <template #result
          ><p>TPSA 从 20.23 Å² 升高到 37.30 Å²（RDKit / Ertl）。</p></template
        >
      </PredictionExercise>
      <h2>改一个基团</h2>
      <SubstituentExplorer
        site="苯环上的预设取代基"
        :variants="[
          { name: '氢 · 苯', smiles: 'c1ccccc1' },
          { name: '羟基 · 苯酚', smiles: 'Oc1ccccc1' },
          { name: '甲基 · 甲苯', smiles: 'Cc1ccccc1' },
        ]"
      />
      <h2>反应与路线</h2>
      <SynthesisRoute :routes="routes" />
      <h2>电子流的关键帧</h2>
      <MechanismViewer :frames="frames" />
      <h2>原页与图片</h2>
      <UiFigure
        src="/showcase/ethanol.svg"
        alt="乙醇的二维结构，两个碳原子连接一个羟基"
        caption="图 1　乙醇（SMILES：CCO）的二维结构"
      />
      <ReadingGuide
        :sources="sources"
        :items="[
          {
            source: 'demo',
            locator: '结构对照示例',
            minutes: 3,
            question: '哪个输入改变了结构，哪个改变了选择状态？',
            skip: '已掌握的鼠标操作',
          },
        ]"
      />
    </div>
  </article>
</template>
