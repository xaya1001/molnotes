import type {
  SubstrateScope,
  SynthesisRoute,
} from "../../../shared/reaction-scheme.ts";
const alcohol = { name: "苯甲醇", smiles: "OCc1ccccc1", number: "1" };
const aldehyde = { name: "苯甲醛", smiles: "O=Cc1ccccc1", number: "2" };
const acid = { name: "苯甲酸", smiles: "O=C(O)c1ccccc1", number: "3" };
const ester = { name: "苯甲酸甲酯", smiles: "COC(=O)c1ccccc1", number: "4" };
const amide = { name: "苯甲酰胺", smiles: "NC(=O)c1ccccc1", number: "5" };
export const schemeRoutes: SynthesisRoute[] = [
  {
    id: "oxidation",
    title: "氧化与衍生化示意",
    core: "c1ccccc1",
    steps: [
      {
        title: "醇到醛",
        reactants: [alcohol],
        products: [aldehyde],
        reagents: ["氧化剂"],
        conditions: ["CH₂Cl₂", "室温，2 h"],
        yield: "85%",
        explanation:
          "羟甲基转为醛基，共有苯环保持相同朝向。示意数据用于检查方案排版。",
      },
      {
        title: "醛到酸",
        reactants: [aldehyde],
        products: [acid],
        reagents: ["氧化剂", "缓冲液"],
        conditions: ["H₂O", "室温，1 h"],
        yield: "90%",
        explanation: "进一步氧化为羧酸；编号 2 在相邻两步指向同一结构。",
      },
      {
        title: "酯化",
        reactants: [acid, { name: "甲醇", smiles: "CO", number: "6" }],
        products: [ester],
        reagents: ["H⁺"],
        conditions: ["MeOH", "回流，4 h"],
        yield: "82%",
        explanation: "羧酸与甲醇形成甲酯；同一反应的多个反应物用加号连接。",
      },
      {
        title: "酯到酰胺",
        reactants: [ester],
        products: [amide],
        reagents: ["NH₃"],
        conditions: ["MeOH", "50 °C，6 h"],
        yield: "78%",
        explanation: "比较酯与酰胺，保留苯甲酰骨架。",
      },
    ],
  },
  {
    id: "retro",
    title: "逆合成示意",
    direction: "retro",
    steps: [
      {
        title: "断开酯键",
        reactants: [ester],
        products: [acid, { name: "甲醇", smiles: "CO", number: "6" }],
        reagents: ["酰氧键断开"],
        conditions: ["逆合成分析"],
        explanation: "空心双线箭头指向候选合成子。",
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
          { name: "水杨酸", smiles: "OC(=O)c1ccccc1O", number: "7" },
          { name: "乙酸酐", smiles: "CC(=O)OC(C)=O", number: "8" },
        ],
        products: [
          { name: "阿司匹林", smiles: "CC(=O)Oc1ccccc1C(=O)O", number: "9" },
          { name: "乙酸", smiles: "CC(=O)O", number: "10" },
        ],
        reagents: ["乙酸酐（示意）"],
        conditions: ["教学结构对照，无实验条件"],
        explanation: "同一步里大小不同的分子按同一键长绘制，小分子不被放大。",
      },
    ],
  },
];
export const scopeExample: SubstrateScope = {
  scheme: {
    title: "取代苯甲酸酯范围示意",
    reactants: [
      { name: "通式酸", smiles: "O=C(O)c1ccc([*:1])cc1", number: "A" },
    ],
    products: [
      { name: "通式酯", smiles: "COC(=O)c1ccc([*:1])cc1", number: "B" },
    ],
    reagents: ["H⁺"],
    conditions: ["MeOH", "回流，4 h"],
    explanation: "R1 表示表中各行取代基；读数为中性排版样本。",
  },
  groups: [{ key: "1", label: "R¹" }],
  readings: [{ key: "purity", label: "纯度" }],
  rows: [
    {
      number: "2a",
      substituents: { "1": "C" },
      yield: "82%",
      readings: { purity: "99%" },
      product: { name: "样品 2a", smiles: "COC(=O)c1ccc(C)cc1" },
    },
    {
      number: "2b",
      substituents: { "1": "OMe" },
      yield: "76%",
      readings: { purity: "98%" },
      product: { name: "样品 2b", smiles: "COC(=O)c1ccc(OC)cc1" },
    },
    {
      number: "2c",
      substituents: { "1": "Cl" },
      yield: "88%",
      readings: { purity: "99%" },
      product: { name: "样品 2c", smiles: "COC(=O)c1ccc(Cl)cc1" },
    },
  ],
};
