export interface PlayerNode {
  name: string;
  detail: string;
  x: number;
}
export interface PlayerStep {
  title: string;
  kind: "transfer" | "local";
  from: number;
  to: number;
  loss: { at: number; index: number; amount: number } | null;
  remaining: number;
  state: string;
  text: string;
  destination: string;
  amounts: (number | null)[];
}
export interface PlayerScenario {
  name: string;
  steps: PlayerStep[];
}
export interface PlayerData {
  title: string;
  diagramLabel: string;
  input: number;
  unit: string;
  nodes: PlayerNode[];
  edges: { from: number; to: number; label: string }[];
  lossNames: string[];
  scenarios: PlayerScenario[];
}

export const formatAmount = (value: number) => String(Number(value.toFixed(2)));

function scenario(
  name: string,
  ratios: [number, number, number],
): PlayerScenario {
  const [a, b, c] = ratios;
  const dissolved = 100 * a;
  const filtered = dissolved * b;
  const extracted = filtered * c;
  const state = (ratio: number, amount: number) =>
    `收率 ${ratio.toFixed(2)} · 剩余 ${formatAmount(amount)} g`;
  return {
    name,
    steps: [
      {
        title: "溶解",
        kind: "transfer",
        from: 0,
        to: 1,
        loss: { at: 0, index: 0, amount: 100 - dissolved },
        remaining: dissolved,
        state: state(a, dissolved),
        text: `投入 100 g 样品，溶解后保留 ${formatAmount(dissolved)} g，未溶残渣占 ${formatAmount(100 - dissolved)} g。`,
        destination: "投料 → 溶解",
        amounts: [0, dissolved, null, null],
      },
      {
        title: "过滤",
        kind: "local",
        from: 1,
        to: 1,
        loss: { at: 1, index: 1, amount: dissolved - filtered },
        remaining: filtered,
        state: state(b, filtered),
        text: `溶解站内完成过滤与水相分离，${formatAmount(dissolved - filtered)} g 留在水相，保留 ${formatAmount(filtered)} g 进入下一站。`,
        destination: "溶解站内部",
        amounts: [0, filtered, null, null],
      },
      {
        title: "萃取分液",
        kind: "transfer",
        from: 1,
        to: 2,
        loss: { at: 2, index: 2, amount: filtered - extracted },
        remaining: extracted,
        state: state(c, extracted),
        text: `样品进入萃取站，分液后计入母液损失 ${formatAmount(filtered - extracted)} g，待收集的样品剩余 ${formatAmount(extracted)} g。`,
        destination: "溶解 → 萃取",
        amounts: [0, 0, extracted, null],
      },
      {
        title: "结晶收集",
        kind: "transfer",
        from: 2,
        to: 3,
        loss: null,
        remaining: extracted,
        state: `总收率 = ${a.toFixed(2)} × ${b.toFixed(2)} × ${c.toFixed(2)} = ${formatAmount(a * b * c * 100)}%`,
        text: `结晶并收集 ${formatAmount(extracted)} g 样品。总收率为三个保留比例之积；本批次的数值为虚构样本。`,
        destination: "萃取 → 收集",
        amounts: [0, 0, 0, extracted],
      },
    ],
  };
}

export const sampleProcess: PlayerData = {
  title: "一批样品的去向",
  diagramLabel: "投料、溶解、萃取、收集四站与各站损失",
  input: 100,
  unit: "g",
  nodes: [
    { name: "投料", detail: "初始样品", x: 90 },
    { name: "溶解", detail: "溶解 · 过滤", x: 270 },
    { name: "萃取", detail: "分液 · 保留", x: 450 },
    { name: "收集", detail: "结晶 · 称量", x: 630 },
  ],
  edges: [
    { from: 0, to: 1, label: "溶解" },
    { from: 1, to: 2, label: "萃取分液" },
    { from: 2, to: 3, label: "结晶收集" },
  ],
  lossNames: ["未溶残渣", "留在水相", "母液损失"],
  scenarios: [
    scenario("常规批次", [0.9, 0.8, 0.6]),
    scenario("损耗批次", [0.95, 0.4, 0.4]),
  ],
};
