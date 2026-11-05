import type {
  MechanismFrame,
  CatalyticCycle,
} from "../../../shared/mechanism.ts";
import type { ReactionStep } from "../../../shared/reaction-scheme.ts";
export const substitution: MechanismFrame[] = [
  {
    title: "亲核进攻",
    explanation: "羟基负离子的孤对电子指向甲基碳；C–Br 键电子对归溴。",
    molecules: [
      {
        id: "electrophile",
        name: "溴甲烷",
        smiles: "CBr",
        atomMap: [1, 2],
        position: { x: 1, y: 0 },
        rotation: 0,
      },
      {
        id: "nucleophile",
        name: "羟基负离子",
        smiles: "[OH-]",
        atomMap: [3],
        position: { x: -3, y: 0 },
      },
    ],
    lonePairs: [{ atom: 3, angle: 0 }],
    arrows: [
      { from: { lonePair: 3 }, to: { atom: 1 }, electrons: 2, bend: -0.45 },
      { from: { bond: [1, 2] }, to: { atom: 2 }, electrons: 2, bend: -0.7 },
    ],
    step: { title: "亲核取代", reversible: false, definitions: ["R¹ = Me"] },
  },
  {
    title: "过渡态",
    explanation: "C–O 键形成与 C–Br 键断裂同时进行，虚线表示部分键。",
    molecules: [
      {
        id: "electrophile",
        name: "底物",
        smiles: "CBr",
        atomMap: [1, 2],
        position: { x: 1, y: 0 },
      },
      {
        id: "nucleophile",
        name: "亲核试剂",
        smiles: "[OH-]",
        atomMap: [3],
        position: { x: -1, y: 0 },
      },
    ],
    transitionState: true,
    partialBonds: [
      [3, 1],
      [1, 2],
    ],
    partialCharges: [
      { atom: 3, charge: "-" },
      { atom: 2, charge: "-" },
    ],
    arrows: [],
    step: { title: "产物形成", reversible: false },
  },
  {
    title: "取代产物",
    explanation: "映射相同的氧与碳形成 C–O 键，溴以溴离子离去。",
    molecules: [
      {
        id: "product",
        name: "甲醇",
        smiles: "CO",
        atomMap: [1, 3],
        position: { x: 0, y: 0 },
      },
      {
        id: "leaving",
        name: "溴离子",
        smiles: "[Br-]",
        atomMap: [2],
        position: { x: 4, y: 0 },
      },
    ],
    arrows: [],
  },
];
export const addition: MechanismFrame[] = [
  {
    title: "羰基加成",
    explanation: "羟基负离子进攻羰基碳，π 电子移向羰基氧。",
    molecules: [
      {
        id: "carbonyl",
        name: "甲醛",
        smiles: "C=O",
        atomMap: [1, 2],
        position: { x: 1, y: 0 },
      },
      {
        id: "oxygen",
        name: "羟基负离子",
        smiles: "[OH-]",
        atomMap: [3],
        position: { x: -3, y: 0 },
      },
    ],
    lonePairs: [{ atom: 3, angle: -20 }],
    arrows: [
      { from: { lonePair: 3 }, to: { atom: 1 }, electrons: 2 },
      { from: { bond: [1, 2] }, to: { atom: 2 }, electrons: 2 },
    ],
    step: { title: "亲核加成", reversible: true },
  },
  {
    title: "四面体中间体",
    explanation: "新 C–O 键保留亲核试剂中氧的来源色。",
    molecules: [
      {
        id: "adduct",
        name: "四面体中间体",
        smiles: "[O-]CO",
        atomMap: [2, 1, 3],
        position: { x: 0, y: 0 },
      },
    ],
    arrows: [],
  },
];
export const radical: MechanismFrame[] = [
  {
    title: "均裂",
    explanation: "每个鱼钩箭头各转移一个电子。",
    molecules: [
      {
        id: "chlorine",
        name: "氯分子",
        smiles: "ClCl",
        atomMap: [1, 2],
        position: { x: 0, y: 0 },
      },
    ],
    arrows: [
      { from: { bond: [1, 2] }, to: { atom: 1 }, electrons: 1, bend: 0.7 },
      { from: { bond: [1, 2] }, to: { atom: 2 }, electrons: 1, bend: 0.7 },
    ],
    step: { title: "光引发", reversible: false },
  },
  {
    title: "氯自由基",
    explanation: "氯分子均裂生成两个氯自由基。",
    molecules: [
      {
        id: "a",
        name: "氯自由基",
        smiles: "[Cl]",
        atomMap: [1],
        position: { x: -2, y: 0 },
      },
      {
        id: "b",
        name: "氯自由基",
        smiles: "[Cl]",
        atomMap: [2],
        position: { x: 2, y: 0 },
      },
    ],
    arrows: [],
  },
];
export const cycleFrames: MechanismFrame[] = [
  {
    title: "零价钯",
    explanation: "芳基溴进入氧化加成步骤。",
    molecules: [
      {
        id: "metal",
        name: "催化剂",
        smiles: "[Pd]",
        abbreviations: ["LnPd"],
        atomMap: [1],
        position: { x: 0, y: 0 },
      },
      {
        id: "aryl",
        name: "芳基溴",
        smiles: "Brc1ccccc1",
        atomMap: [2, 3, 4, 5, 6, 7, 8],
        position: { x: 5, y: 0 },
      },
      {
        id: "boron",
        name: "芳基硼酸",
        smiles: "OB(O)c1ccccc1",
        atomMap: [15, 16, 17, 9, 10, 11, 12, 13, 14],
        position: { x: -5, y: 0 },
      },
    ],
    arrows: [],
    step: { title: "氧化加成", reversible: false },
  },
  {
    title: "芳基钯卤化物",
    explanation: "转金属化把第二个芳基转移到钯。",
    molecules: [
      {
        id: "metal",
        name: "芳基钯",
        smiles: "Br[Pd]c1ccccc1",
        abbreviations: ["LnPd"],
        atomMap: [2, 1, 3, 4, 5, 6, 7, 8],
        position: { x: 0, y: 0 },
      },
      {
        id: "boron",
        name: "芳基硼酸",
        smiles: "OB(O)c1ccccc1",
        atomMap: [15, 16, 17, 9, 10, 11, 12, 13, 14],
        position: { x: -6, y: 0 },
      },
    ],
    arrows: [],
    step: { title: "转金属化", reversible: false },
  },
  {
    title: "二芳基钯",
    explanation: "还原消除形成联芳基并再生零价钯。",
    molecules: [
      {
        id: "metal",
        name: "二芳基钯",
        smiles: "[Pd](c1ccccc1)c1ccccc1",
        abbreviations: ["LnPd"],
        atomMap: [1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
        position: { x: 0, y: 0 },
      },
    ],
    arrows: [],
    step: { title: "还原消除", reversible: false },
  },
  {
    title: "再生催化剂",
    explanation: "联芳基离开循环，钯进入下一轮。",
    molecules: [
      {
        id: "metal",
        name: "催化剂",
        smiles: "[Pd]",
        abbreviations: ["LnPd"],
        atomMap: [1],
        position: { x: 0, y: 0 },
      },
      {
        id: "product",
        name: "联芳基",
        smiles: "c1ccccc1-c1ccccc1",
        atomMap: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
        position: { x: 5, y: 0 },
      },
    ],
    arrows: [],
    step: { title: "进入下一循环", reversible: false },
  },
];
export const couplingCycle: CatalyticCycle = {
  intermediates: ["metal", "metal", "metal", "metal"],
  steps: [
    {
      title: "氧化加成",
      branches: [{ direction: "in", frame: 0, molecule: "aryl" }],
    },
    {
      title: "转金属化",
      branches: [{ direction: "in", frame: 1, molecule: "boron" }],
    },
    {
      title: "还原消除",
      branches: [{ direction: "out", frame: 3, molecule: "product" }],
    },
    { title: "进入下一循环" },
  ],
};
export const overall: ReactionStep = {
  title: "亲核取代",
  reactants: [
    { name: "溴甲烷", smiles: "CBr", number: "1" },
    { name: "羟基负离子", smiles: "[OH-]", number: "2" },
  ],
  products: [{ name: "甲醇", smiles: "CO", number: "3" }],
  reagents: ["OH⁻"],
  conditions: ["水"],
  explanation: "亲核取代示意。",
};
