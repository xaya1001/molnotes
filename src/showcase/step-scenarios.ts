import {
  formatAmount,
  type ProcessData,
  type ProcessStep,
} from "../../shared/process.ts";

function scenario(
  name: string,
  ratios: [number, number, number],
): { name: string; steps: ProcessStep[] } {
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
        label: "溶解",
        kind: "transfer",
        from: 0,
        to: 1,
        loss: { node: 0, label: "未溶残渣", amount: 100 - dissolved },
        state: state(a, dissolved),
        text: `投入 100 g 样品，溶解后保留 ${formatAmount(dissolved)} g，未溶残渣占 ${formatAmount(100 - dissolved)} g。`,
        amounts: [0, dissolved, null, null],
      },
      {
        title: "过滤",
        kind: "local",
        from: 1,
        to: 1,
        loss: { node: 1, label: "留在水相", amount: dissolved - filtered },
        state: state(b, filtered),
        text: `溶解站内完成过滤与水相分离，${formatAmount(dissolved - filtered)} g 留在水相，保留 ${formatAmount(filtered)} g 进入下一站。`,
        amounts: [0, filtered, null, null],
      },
      {
        title: "萃取分液",
        label: "萃取",
        kind: "transfer",
        from: 1,
        to: 2,
        loss: { node: 2, label: "母液损失", amount: filtered - extracted },
        state: state(c, extracted),
        text: `样品进入萃取站，分液后计入母液损失 ${formatAmount(filtered - extracted)} g，待收集的样品剩余 ${formatAmount(extracted)} g。`,
        amounts: [0, 0, extracted, null],
      },
      {
        title: "结晶收集",
        label: "收集",
        kind: "transfer",
        from: 2,
        to: 3,
        state: `总收率 = ${a.toFixed(2)} × ${b.toFixed(2)} × ${c.toFixed(2)} = ${formatAmount(a * b * c * 100)}%`,
        text: `结晶并收集 ${formatAmount(extracted)} g 样品。总收率为三个保留比例之积。`,
        amounts: [0, 0, 0, extracted],
      },
    ],
  };
}

export const sampleProcess: ProcessData = {
  title: "一批样品的去向",
  label: "投料、溶解、萃取、收集四站与各站损失",
  total: { amount: 100, unit: "g", label: "样品去向" },
  nodes: [
    { name: "投料", detail: "初始样品" },
    { name: "溶解", detail: "溶解 · 过滤" },
    { name: "萃取", detail: "分液 · 保留" },
    { name: "收集", detail: "结晶 · 称量" },
  ],
  scenarios: [
    scenario("常规批次", [0.9, 0.8, 0.6]),
    scenario("损耗批次", [0.95, 0.4, 0.4]),
  ],
};
