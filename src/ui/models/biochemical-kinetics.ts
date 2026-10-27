/** Protein degradation teaching models. Time h; rate h^-1; concentration nM; protein %. */
import type { LabInput, LabModel } from "./catalog.ts";
import type { Unchecked } from "../../../shared/unchecked.ts";
export function degradation(dmax: number, halfMax: number, drug: number) {
  return (dmax * drug) / (halfMax + drug);
}
export function absoluteHalfLoss(dmax: number, halfMax: number) {
  return dmax > 50 ? (halfMax * 50) / (dmax - 50) : null;
}
export function proteinAt(
  time: number,
  halfLife: number,
  kdeg: number,
  washout: number,
) {
  const basal = Math.LN2 / halfLife;
  const steady = basal / (basal + kdeg);
  const atWashout = steady + (1 - steady) * Math.exp(-(basal + kdeg) * washout);
  return (
    100 *
    (time <= washout
      ? steady + (1 - steady) * Math.exp(-(basal + kdeg) * time)
      : 1 + (atWashout - 1) * Math.exp(-basal * (time - washout)))
  );
}
const proteinTurnover: LabModel = {
  inputs: [
    {
      id: "halfLife",
      label: "基础半衰期",
      kind: "number",
      control: "range",
      min: 2,
      max: 48,
      step: 1,
      unit: "h",
      default: 24,
    },
    {
      id: "kdeg",
      label: "额外降解速率",
      kind: "number",
      control: "range",
      min: 0,
      max: 1,
      step: 0.01,
      unit: "h⁻¹",
      default: 0.25,
    },
    {
      id: "washout",
      label: "撤药时间",
      kind: "number",
      control: "range",
      min: 0,
      max: 48,
      step: 1,
      unit: "h",
      default: 24,
    },
  ],
  run({
    halfLife,
    kdeg,
    washout,
  }: {
    halfLife: number;
    kdeg: number;
    washout: number;
  }) {
    return {
      summary: `24 h 总蛋白：${proteinAt(24, halfLife, kdeg, washout).toFixed(1)}%；48 h 总蛋白：${proteinAt(48, halfLife, kdeg, washout).toFixed(1)}%。`,
      charts: [
        {
          xLabel: "时间（h）",
          yLabel: "总蛋白（% 基线）",
          points: Array.from({ length: 145 }, (_, i) => ({
            x: i / 2,
            y: proteinAt(i / 2, halfLife, kdeg, washout),
          })),
        },
      ],
    };
  },
};
const proteinLossCurve: LabModel = {
  inputs: [
    {
      id: "dmax",
      label: "Dmax",
      kind: "number",
      control: "range",
      min: 20,
      max: 99,
      step: 1,
      unit: "%",
      default: 90,
    },
    {
      id: "halfMax",
      label: "半最大效应浓度",
      kind: "number",
      control: "range",
      min: 1,
      max: 50,
      step: 1,
      unit: "nM",
      default: 10,
    },
  ],
  run({ dmax, halfMax }: { dmax: number; halfMax: number }) {
    const absolute = absoluteHalfLoss(dmax, halfMax);
    return {
      summary: `在 K = ${halfMax} nM 时下降 ${dmax / 2}%；绝对 50% 损失浓度：${absolute === null ? "有限浓度下不可达" : absolute.toFixed(2) + " nM"}。`,
      charts: [
        {
          xLabel: "浓度（nM）",
          yLabel: "蛋白损失（%）",
          points: Array.from({ length: 101 }, (_, i) => ({
            x: i,
            y: degradation(dmax, halfMax, i),
          })),
        },
      ],
    };
  },
};
/** Two-state RAS teaching model; rates min^-1, no synthesis or feedback. */
export const rasSteady = (exchange: number, hydrolysis: number) =>
  exchange + hydrolysis === 0 ? 0 : exchange / (exchange + hydrolysis);
export const kobs = (inhibitor: number, ki: number, kinact: number) =>
  (kinact * inhibitor) / (ki + inhibitor);
export const engagement = (rate: number, minutes: number) =>
  -Math.expm1(-rate * minutes);
export const lowConcentrationRate = (efficiency: number, inhibitor: number) =>
  efficiency * inhibitor * 1e-6 * 60;
const gtpaseSteadyState: LabModel = {
  inputs: [
    {
      id: "exchange",
      label: "有效交换速率",
      kind: "number",
      control: "range",
      min: 0,
      max: 2,
      step: 0.01,
      unit: "min⁻¹",
      default: 0.2,
    },
    {
      id: "hydrolysis",
      label: "有效水解速率",
      kind: "number",
      control: "range",
      min: 0.01,
      max: 2,
      step: 0.01,
      unit: "min⁻¹",
      default: 0.8,
    },
  ],
  run({ exchange, hydrolysis }: { exchange: number; hydrolysis: number }) {
    return {
      summary: `Ras–GTP 稳态分数：${(rasSteady(exchange, hydrolysis) * 100).toFixed(1)}%`,
      charts: [
        {
          xLabel: "交换速率 / min⁻¹",
          yLabel: "GTP 分数 / %",
          points: Array.from({ length: 41 }, (_, i) => ({
            x: i / 20,
            y: rasSteady(i / 20, hydrolysis) * 100,
          })),
        },
      ],
    };
  },
};
const covalentEngagement: LabModel = {
  inputs: [
    {
      id: "mode",
      label: "参数来源",
      kind: "select",
      default: "tool-compound",
      options: [
        { value: "tool-compound", label: "早期工具化合物：发表的二级速率" },
        {
          value: "clinical-compound",
          label: "临床化合物：原论文报告的二级速率",
        },
        { value: "teaching", label: "教学两步模型：自行改变 KI 与 kinact" },
      ],
    },
    {
      id: "inhibitor",
      label: "游离抑制剂 I",
      kind: "number",
      control: "range",
      min: 0,
      max: 5,
      step: 0.1,
      unit: "µM",
      default: 1,
    },
    {
      id: "ki",
      label: "KI",
      kind: "number",
      control: "range",
      min: 1,
      max: 100,
      step: 1,
      unit: "µM",
      default: 10,
    },
    {
      id: "kinact",
      label: "kinact",
      kind: "number",
      control: "range",
      min: 0.01,
      max: 1,
      step: 0.01,
      unit: "min⁻¹",
      default: 0.1,
    },
    {
      id: "minutes",
      label: "孵育时间",
      kind: "number",
      control: "range",
      min: 0,
      max: 360,
      step: 5,
      unit: "min",
      default: 60,
    },
  ],
  run({
    mode,
    inhibitor,
    ki,
    kinact,
    minutes,
  }: {
    mode: string;
    inhibitor: number;
    ki: number;
    kinact: number;
    minutes: number;
  }) {
    const rate =
      mode === "teaching"
        ? kobs(inhibitor, ki, kinact)
        : lowConcentrationRate(mode === "tool-compound" ? 76 : 9900, inhibitor);
    return {
      summary: `kobs = ${rate.toFixed(5)} min⁻¹；${minutes} min 共价占据 ${(engagement(rate, minutes) * 100).toFixed(1)}%`,
      charts: [
        {
          xLabel: "时间 / min",
          yLabel: "共价占据 / %",
          points: Array.from({ length: 61 }, (_, i) => ({
            x: i * 6,
            y: engagement(rate, i * 6) * 100,
          })),
        },
      ],
    };
  },
};

/**
 * Apparent inhibition constant of a reversible ATP-competitive inhibitor,
 * Ki,app = Ki (1 + [ATP]/Km). Ki and the result in nM, ATP and Km in µM.
 * Assumes equilibrium competition; no covalent loss, membrane crossing or turnover.
 */
export function apparentKi(kiNm: number, atpUm: number, kmUm: number) {
  return kiNm * (1 + atpUm / kmUm);
}
/** Apparent panel ratio; both entries must be from the same endpoint/unit. */
export function panelRatio(wildType: number, mutant: number) {
  return wildType / mutant;
}

/** A reading without exponent: whole numbers from 100 (1309), one decimal from 10 (70.3), two from 1 (9.32), two significant figures below (0.46). */
export function readout(value: Unchecked) {
  if (value >= 100) return String(Math.round(value));
  if (value >= 10) return value.toFixed(1);
  if (value >= 1) return value.toFixed(2);
  return value.toPrecision(2);
}

/** 10 µM is shown as "10 µM", 1000 µM as "1 mM". */
export function atpLabel(atpUm: number) {
  return atpUm >= 1000 ? `${atpUm / 1000} mM` : `${atpUm} µM`;
}

const atpCompetition: LabModel = {
  validateData(data) {
    requireCase(caseObject(data), "ATP experiment");
    for (const key of ["variants", "inhibitors"]) {
      requireCase(
        Array.isArray(data[key]) &&
          data[key].length > 0 &&
          data[key].every(caseText),
        key,
      );
      requireCase(new Set(data[key]).size === data[key].length, key);
    }
    requireCase(
      caseObject(data.inhibitorLabels) &&
        caseObject(data.kd) &&
        caseObject(data.km),
      "ATP datasets",
    );
    for (const inhibitor of data.inhibitors) {
      requireCase(
        caseText(data.inhibitorLabels[inhibitor]) &&
          caseObject(data.kd[inhibitor]),
        "inhibitor",
      );
      for (const variant of data.variants) {
        for (const value of [data.kd[inhibitor][variant], data.km[variant]]) {
          requireCase(
            caseObject(value) &&
              Number.isFinite(value.value) &&
              value.value > 0 &&
              Number.isFinite(value.sd) &&
              value.sd >= 0,
            "measurement",
          );
        }
      }
    }
    for (const key of ["atpSteps", "comparisonAtp"])
      requireCase(
        Array.isArray(data[key]) &&
          data[key].length > 0 &&
          data[key].every((v) => Number.isFinite(v) && v >= 0),
        key,
      );
    requireCase(
      Number.isInteger(data.defaultStep) &&
        data.defaultStep >= 0 &&
        data.defaultStep < data.atpSteps.length,
      "defaultStep",
    );
    requireCase(caseObject(data.roles), "roles");
    for (const role of ["reference", "numerator", "denominator"])
      requireCase(data.variants.includes(data.roles[role]), role);
    requireCase(
      data.roles.numerator !== data.roles.denominator,
      "comparison roles",
    );
    for (const key of [
      "parameterCaption",
      "comparisonCaption",
      "referenceWarning",
    ])
      requireCase(caseText(data[key]), key);
    for (const [key, count] of [
      ["parameterColumns", 5],
      ["comparisonColumns", 4],
    ])
      requireCase(
        Array.isArray(data[key]) &&
          data[key].length === count &&
          data[key].every(caseText),
        key,
      );
  },
  inputs: (data) => [
    {
      id: "inhibitor",
      label: "抑制剂",
      kind: "select",
      default: data.inhibitors[0],
      options: data.inhibitors.map((value: Unchecked) => ({
        value,
        label: data.inhibitorLabels[value],
      })),
    },
    {
      id: "step",
      label: "ATP 浓度",
      kind: "number",
      control: "range",
      min: 0,
      max: data.atpSteps.length - 1,
      step: 1,
      default: data.defaultStep,
    },
  ],
  run({ inhibitor, step }: { inhibitor: number; step: number }, data) {
    const atp = data.atpSteps[step];
    const { reference, numerator, denominator } = data.roles;
    const kiAt = (variant: string, concentration: number) =>
      apparentKi(
        data.kd[inhibitor][variant].value,
        concentration,
        data.km[variant].value,
      );
    const rows = data.variants.map((variant: string) => {
      const kd = data.kd[inhibitor][variant],
        km = data.km[variant],
        ki = kiAt(variant, atp);
      return [
        variant,
        kd.value + " ± " + kd.sd,
        km.value + " ± " + km.sd,
        readout(ki),
        readout(kiAt(reference, atp) / ki),
      ];
    });
    const numeratorKi = kiAt(numerator, atp),
      denominatorKi = kiAt(denominator, atp);
    return {
      summary:
        atpLabel(atp) +
        " ATP 下，" +
        numerator +
        " 的 Ki,app 是 " +
        denominator +
        " 的 " +
        readout(numeratorKi / denominatorKi) +
        " 倍。" +
        (kiAt(reference, atp) / numeratorKi < 1 ? data.referenceWarning : ""),
      tables: [
        {
          caption: data.parameterCaption,
          columns: data.parameterColumns,
          rows,
        },
        {
          caption: data.comparisonCaption,
          columns: data.comparisonColumns,
          rows: data.comparisonAtp.map((a: number) => [
            atpLabel(a),
            readout(kiAt(denominator, a)),
            readout(kiAt(numerator, a)),
            readout(kiAt(numerator, a) / kiAt(denominator, a)),
          ]),
        },
      ],
    };
  },
};
const caseText = (value: Unchecked) =>
  typeof value === "string" && value.trim().length > 0;
const caseObject = (value: Unchecked) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
function requireCase(condition: Unchecked, field: Unchecked) {
  if (!condition) throw new Error(`模型数据 ${field} 无效`);
}

const assayPanel: LabModel = {
  validateData(data: Unchecked) {
    requireCase(caseObject(data), "panel");
    requireCase(caseText(data.caption), "caption");
    requireCase(
      Array.isArray(data.endpoints) && data.endpoints.length > 0,
      "endpoints",
    );
    const ids = new Set();
    for (const endpoint of data.endpoints) {
      requireCase(
        caseObject(endpoint) &&
          caseText(endpoint.value) &&
          caseText(endpoint.label),
        "endpoint",
      );
      requireCase(!ids.has(endpoint.value), "endpoint.value");
      ids.add(endpoint.value);
      requireCase(
        Array.isArray(endpoint.columns) &&
          endpoint.columns.length >= 3 &&
          endpoint.columns.every(caseText),
        "endpoint.columns",
      );
    }
    requireCase(caseObject(data.ratio), "ratio");
    requireCase(Array.isArray(data.rows) && data.rows.length > 0, "rows");
    for (const row of data.rows) {
      requireCase(caseObject(row) && caseText(row.name), "row.name");
      for (const endpoint of data.endpoints) {
        const values = row[endpoint.value];
        requireCase(
          Array.isArray(values) &&
            values.length === endpoint.columns.length - 2 &&
            values.every((v) => Number.isFinite(v) && v >= 0),
          "row.values",
        );
        for (const index of [data.ratio.numerator, data.ratio.denominator])
          requireCase(
            Number.isInteger(index) && index >= 0 && index < values.length,
            "ratio index",
          );
        requireCase(values[data.ratio.denominator] > 0, "ratio denominator");
      }
    }
  },
  inputs: (data: Unchecked) => [
    {
      id: "endpoint",
      label: "测定终点",
      kind: "select",
      default: data.endpoints[0].value,
      options: data.endpoints.map(({ value, label }: Unchecked) => ({
        value,
        label,
      })),
    },
  ],
  run({ endpoint }: { endpoint: number }, data: Unchecked) {
    const selected = data.endpoints.find(
      (item: Unchecked) => item.value === endpoint,
    );
    return {
      tables: [
        {
          caption: data.caption,
          columns: selected.columns,
          rows: data.rows.map((row: Unchecked) => {
            const values = row[endpoint];
            return [
              row.name,
              ...values.map(String),
              panelRatio(
                values[data.ratio.numerator],
                values[data.ratio.denominator],
              ).toPrecision(3),
            ];
          }),
        },
      ],
    };
  },
};
/** Teaching model: instantaneous normalized input, one compartment, first-order elimination.
 * timeHours and halfLifeHours are hours; output is percent of C(0), not measured exposure.
 * No absorption, distribution, repeat dosing, receptor binding or active metabolites.
 */
export function remainingPercent(timeHours: number, halfLifeHours: number) {
  if (
    !Number.isFinite(timeHours) ||
    timeHours < 0 ||
    !Number.isFinite(halfLifeHours) ||
    halfLifeHours <= 0
  )
    throw new RangeError("时间须为非负数，半衰期须为正数");
  return 100 * Math.pow(2, -timeHours / halfLifeHours);
}
export function eliminationCurve(halfLifeHours: number, horizonHours = 168) {
  remainingPercent(horizonHours, halfLifeHours);
  // Include sub-minute points and half-life landmarks even on a one-week axis.
  const times = new Set([0, horizonHours]);
  for (let i = 0; i <= 168; i++) times.add((horizonHours * i) / 168);
  for (let i = 0; i <= 100; i++) {
    const t = (halfLifeHours * i) / 10;
    if (t <= horizonHours) times.add(t);
  }
  return [...times]
    .sort((a, b) => a - b)
    .map((t) => [t, remainingPercent(t, halfLifeHours)]);
}
const firstOrderElimination: LabModel = {
  validateData(data) {
    requireCase(
      caseObject(data) &&
        Array.isArray(data.presets) &&
        data.presets.length > 0,
      "presets",
    );
    for (const preset of data.presets) {
      requireCase(
        caseObject(preset) && caseText(preset.name) && caseText(preset.label),
        "preset",
      );
      requireCase(
        Number.isFinite(preset.halfLife) && preset.halfLife > 0,
        "preset.halfLife",
      );
      requireCase(
        caseText(preset.source) ||
          (Number.isInteger(preset.source) && preset.source > 0),
        "preset.source",
      );
    }
  },
  inputs: (data) => [
    {
      id: "selected",
      label: "药物预设",
      kind: "select",
      default: 0,
      options: data.presets.map((p: Unchecked, i: number) => ({
        value: i,
        label: p.name,
      })),
    },
    {
      id: "time",
      label: "观察时间（h，默认 24）",
      kind: "number",
      control: "range",
      min: 0,
      max: 168,
      step: 0.01,
      default: 24,
    },
    {
      id: "horizon",
      label: "横轴范围",
      kind: "select",
      default: 168,
      options: [
        { value: 168, label: "一周（168 h）" },
        { value: 1, label: "前 1 h" },
        { value: 0.25, label: "前 15 min（0.25 h）" },
      ],
    },
  ],
  run(
    {
      selected,
      time,
      horizon,
    }: { selected: number; time: number; horizon: number },
    data,
  ) {
    const preset = data.presets[selected];
    return {
      summary: `${time} h 后：${remainingPercent(time, preset.halfLife).toFixed(4)}% C(0)`,
      readouts: [
        { label: preset.name, value: preset.label + ` [${preset.source}]` },
      ],
      charts: [
        {
          xLabel: "时间 / h",
          yLabel: "剩余 / % C(0)",
          points: eliminationCurve(preset.halfLife, horizon).map(([x, y]) => ({
            x,
            y,
          })),
        },
      ],
    };
  },
};
const degradationDoseResponse: LabModel = {
  inputs: [
    {
      id: "dmax",
      label: "最大降解 Dmax（%）",
      kind: "number",
      control: "range",
      min: 0,
      max: 100,
      step: 5,
      default: 80,
    },
    {
      id: "halfMax",
      label: "相对半效应浓度 C½（nM）",
      kind: "number",
      control: "range",
      min: 1,
      max: 50,
      step: 1,
      default: 10,
    },
    {
      id: "drug",
      label: "测试浓度 C（nM）",
      kind: "number",
      control: "range",
      min: 0,
      max: 100,
      step: 1,
      default: 10,
    },
  ],
  run({
    dmax,
    halfMax,
    drug,
  }: {
    dmax: number;
    halfMax: number;
    drug: number;
  }) {
    const loss = degradation(dmax, halfMax, drug),
      absolute = absoluteHalfLoss(dmax, halfMax);
    return {
      summary: `蛋白损失 ${loss.toFixed(1)}%；剩余 ${(100 - loss).toFixed(1)}%。绝对损失 50% 所需浓度：${absolute === null ? "有限浓度下不可达" : `${absolute.toFixed(1)} nM`}。`,
      charts: [
        {
          xLabel: "浓度 / nM",
          yLabel: "蛋白损失 / %",
          points: Array.from({ length: 101 }, (_, x) => ({
            x,
            y: degradation(dmax, halfMax, x),
          })),
        },
      ],
    };
  },
};
/** Single-site aqueous acid/base teaching models, no coupled ionizations. */

/** Fraction protonated (HA or BH+); pH and pKa are dimensionless. */
export function protonated(pH: number, pKa: number) {
  return 1 / (1 + 10 ** (pH - pKa));
}
/** Mean charge of this side chain only, in elementary charge e. */
export function sideChainCharge(pH: number, pKa: number, kind: string) {
  const f = protonated(pH, pKa);
  return kind === "acid" ? f - 1 : f;
}
export function neutralFraction(pH: number, pKa: number, kind: string) {
  const f = protonated(pH, pKa);
  return kind === "acid" ? f : 1 - f;
}
/** Free ligand and Kd in nM; Kd > 0; reversible 1:1 equilibrium. */
export function occupancy(ligand: number, kd: number) {
  return ligand / (kd + ligand);
}
/** kon in M^-1 s^-1; Kd in nM; returns koff in s^-1. */
export function offRate(kd: number, kon: number) {
  return kd * 1e-9 * kon;
}
/** Starts unbound, constant free ligand (nM); time seconds, kon M^-1 s^-1. */
export function association(
  ligand: number,
  kd: number,
  kon: number,
  time: number,
) {
  const koff = offRate(kd, kon);
  return (
    occupancy(ligand, kd) * -Math.expm1(-(kon * ligand * 1e-9 + koff) * time)
  );
}

/** Km, I, Ki in µM (Km,Ki>0); Vmax in µM/min. Pure noncompetitive only. */
export function enzymeParameters(
  km: number,
  vmax: number,
  inhibitor: number,
  ki: number,
  mode: string,
) {
  const a = 1 + inhibitor / ki;
  return {
    km:
      mode === "competitive" ? km * a : mode === "uncompetitive" ? km / a : km,
    vmax:
      mode === "noncompetitive" || mode === "uncompetitive" ? vmax / a : vmax,
  };
}
/** Initial velocity in µM/min; substrate in µM; no depletion or cooperativity. */
export function velocity(
  substrate: number,
  km: number,
  vmax: number,
  inhibitor: number,
  ki: number,
  mode: string,
) {
  const p = enzymeParameters(km, vmax, inhibitor, ki, mode);
  return (p.vmax * substrate) / (p.km + substrate);
}
/** Arbitrary bounded teaching index z/(1+z), z=f_neutral*10^logP; NOT Papp. */
export function permeability(
  pH: number,
  pKa: number,
  logP: number,
  kind: string,
) {
  const z = neutralFraction(pH, pKa, kind) * 10 ** logP;
  return z / (1 + z);
}
/** Copies in a uniform volume (pL) converted to nM using exact SI NA. */
export function copiesToNm(copies: Unchecked, volumePl: number) {
  return (copies / (6.02214076e23 * volumePl * 1e-12)) * 1e9;
}
/** First-order dissociation: koff in s^-1 from the dissociative half-life in s. */
export function koffFromHalfLife(halfLife: number) {
  return Math.LN2 / halfLife;
}
/** Mean waiting time before a bound ligand leaves, s; koff in s^-1. */
export function residenceTime(koff: number) {
  return 1 / koff;
}
/** Fraction of the complex that has dissociated after `time` s with no rebinding. */
export function dissociated(time: number, halfLife: number) {
  return 1 - 2 ** (-time / halfLife);
}
/**
 * Two-step binding E+I <-> EI <-> EI* (Copeland, Pompliano & Meek 2006, eq. 3):
 * k1 in M^-1 s^-1, k2..k4 in s^-1. Ki and Ki* in nM, koff in s^-1, t1/2 in s.
 */
export function twoStep(k1: number, k2: number, k3: number, k4: number) {
  const koff = (k2 * k4) / (k2 + k3 + k4);
  return {
    ki: (k2 / k1) * 1e9,
    kiStar: ((k2 * k4) / (k1 * (k3 + k4))) * 1e9,
    koff,
    halfLife: koffFromHalfLife(koff),
  };
}
/**
 * IC50 of a reversible inhibitor at [S]/Km, in the unit of ki, where ki is
 * the dissociation constant of the enzyme form the inhibitor binds
 * (Copeland 2e, eq. 5.10-5.12 with alpha = 1 for the noncompetitive case).
 * Uncompetitive inhibition has no IC50 without substrate: it grows without bound.
 */
export function ic50(substrateOverKm: number, ki: number, mode: string) {
  if (mode === "competitive") return ki * (1 + substrateOverKm);
  if (mode === "noncompetitive") return ki;
  return substrateOverKm === 0 ? Infinity : ki * (1 + 1 / substrateOverKm);
}

const numberInput = (
  id: string,
  label: string,
  min: number,
  max: number,
  step: number,
  defaultValue: number,
): LabInput => ({
  id,
  label,
  kind: "number",
  control: "range",
  min,
  max,
  step,
  default: defaultValue,
});
const bioScaleObjects: [string, number, string][] = [
  ["小分子", 1, "教学量级：约 1 nm"],
  ["球状蛋白", 5, "教学量级：约 5 nm"],
  ["核糖体", 20, "约 20 nm"],
  ["线粒体", 2000, "微米级示例，仅比较尺寸"],
  ["细胞", 20000, "约 20 µm 的教学示例，细胞尺寸差别很大"],
  ["人发直径", 100000, "100 µm 参照；未在指定章节核得，非教材测量值"],
];
const bioScale: LabModel = {
  inputs: [
    numberInput("exponent", "log10(长度/nm)", 0, 5, 0.1, 3),
    numberInput("copiesLog", "log10(蛋白拷贝数)", 3, 6, 0.1, 4),
  ],
  run({ exponent, copiesLog }: { exponent: number; copiesLog: number }) {
    const nearest = bioScaleObjects.reduce((a, b) =>
      Math.abs(Math.log10(a[1]) - exponent) <
      Math.abs(Math.log10(b[1]) - exponent)
        ? a
        : b,
    );
    return {
      summary:
        "当前长度 " +
        (10 ** exponent).toPrecision(3) +
        " nm，最接近" +
        nearest[0] +
        "的量级。",
      readouts: [
        {
          label: "假设均匀分布在 1 pL",
          value:
            Math.round(10 ** copiesLog).toLocaleString() +
            " 个分子 ≈ " +
            copiesToNm(10 ** copiesLog, 1).toFixed(2) +
            " nM。",
        },
      ],
    };
  },
};
const bioSidechains: [string, number, string][] = [
  ["Asp · 羧酸", 3.65, "acid"],
  ["Glu · 羧酸", 4.25, "acid"],
  ["His · 咪唑", 6, "base"],
  ["Cys · 硫醇", 8.18, "acid"],
  ["Tyr · 酚", 10.07, "acid"],
  ["Lys · 胺", 10.53, "base"],
  ["Arg · 胍", 12.48, "base"],
];
const bioIonization: LabModel = {
  inputs: [
    {
      id: "selected",
      label: "氨基酸侧链",
      kind: "select",
      default: 2,
      options: bioSidechains.map(([name, pKa], i) => ({
        value: i,
        label: name + " · pKa " + pKa,
      })),
    },
    numberInput("pH", "pH", 0, 14, 0.01, 7),
  ],
  run({ selected, pH }: { selected: number; pH: number }) {
    const [, pKa, kind] = bioSidechains[selected],
      f = protonated(pH, pKa);
    return {
      summary:
        "质子化：" +
        (100 * f).toFixed(1) +
        "%；去质子化：" +
        (100 * (1 - f)).toFixed(1) +
        "%；平均侧链电荷：" +
        sideChainCharge(pH, pKa, kind).toFixed(3) +
        " e。",
      charts: [
        {
          xLabel: "pH",
          yLabel: "质子化 / %",
          points: Array.from({ length: 71 }, (_, i) => ({
            x: i / 5,
            y: 100 * protonated(i / 5, pKa),
          })),
        },
      ],
    };
  },
};
const bioBinding: LabModel = {
  inputs: [
    numberInput("kd", "Kd（nM）", 1, 100, 1, 10),
    numberInput("logL", "log10(L/nM)", -1, 4, 0.1, 1),
    numberInput("logKon", "log10(kon)", 4, 7, 0.1, 6),
    numberInput("time", "观察时间（s）", 0, 1000, 10, 100),
  ],
  run({
    kd,
    logL,
    logKon,
    time,
  }: {
    kd: number;
    logL: number;
    logKon: number;
    time: number;
  }) {
    const ligand = 10 ** logL,
      kon = 10 ** logKon,
      koff = offRate(kd, kon);
    return {
      summary:
        "游离 L = " +
        ligand.toFixed(2) +
        " nM；平衡占有率 " +
        (100 * occupancy(ligand, kd)).toFixed(1) +
        "%；当前时刻 " +
        (100 * association(ligand, kd, kon, time)).toFixed(1) +
        "%。koff = " +
        koff.toPrecision(3) +
        " s⁻¹；停留时间 τ = " +
        (1 / koff).toPrecision(3) +
        " s。",
      charts: [
        {
          xLabel: "log10(L / 0.1 nM)",
          yLabel: "平衡占有率 / %",
          points: Array.from({ length: 101 }, (_, i) => ({
            x: i / 20,
            y: 100 * occupancy(10 ** (i / 20 - 1), kd),
          })),
        },
        {
          xLabel: "时间 / s",
          yLabel: "占有率 / %",
          points: Array.from({ length: 101 }, (_, i) => ({
            x: i * 10,
            y: 100 * association(ligand, kd, kon, i * 10),
          })),
        },
      ],
    };
  },
};
const bioModes = [
  ["none", "无抑制"],
  ["competitive", "竞争性"],
  ["noncompetitive", "纯非竞争性"],
  ["uncompetitive", "反竞争性"],
];
const bioEnzyme: LabModel = {
  inputs: [
    {
      id: "mode",
      label: "抑制模式",
      kind: "select",
      default: "competitive",
      options: bioModes.map(([value, label]) => ({ value, label })),
    },
    numberInput("substrate", "底物浓度 [S]（µM）", 0, 200, 1, 10),
    numberInput("km", "Km（µM）", 1, 100, 1, 10),
    numberInput("vmax", "Vmax（µM/min）", 10, 200, 1, 100),
    numberInput("inhibitor", "抑制剂浓度 [I]（µM）", 0, 100, 1, 10),
    numberInput("ki", "Ki（µM）", 1, 100, 1, 10),
  ],
  run({
    mode,
    substrate,
    km,
    vmax,
    inhibitor,
    ki,
  }: {
    mode: string;
    substrate: number;
    km: number;
    vmax: number;
    inhibitor: number;
    ki: number;
  }) {
    const p = enzymeParameters(km, vmax, inhibitor, ki, mode),
      ratio = substrate / km,
      now = mode === "none" ? undefined : ic50(ratio, ki, mode);
    return {
      summary:
        "当前速率 v = " +
        velocity(substrate, km, vmax, inhibitor, ki, mode).toFixed(2) +
        " µM/min；表观 Km = " +
        p.km.toFixed(2) +
        " µM；表观 Vmax = " +
        p.vmax.toFixed(2) +
        " µM/min。",
      readouts: [
        {
          label: "同一 [S] 下无抑制的速率",
          value:
            velocity(substrate, km, vmax, 0, ki, "none").toFixed(2) +
            " µM/min。",
        },
        {
          label: "IC50 随 [S]/Km 变化",
          value:
            now === undefined
              ? "选一种抑制模式后显示 IC50；无抑制剂时没有 IC50。"
              : Number.isFinite(now)
                ? "[S]/Km = " +
                  ratio.toFixed(2) +
                  " 时，IC50 = " +
                  now.toFixed(2) +
                  " µM，是 Ki 的 " +
                  (now / ki).toFixed(2) +
                  " 倍。"
                : "[S] = 0 时反竞争抑制无从发生，IC50 趋于无穷。",
        },
      ],
      charts: [
        {
          xLabel: "[S] / µM",
          yLabel: "v / µM·min⁻¹",
          points: Array.from({ length: 101 }, (_, i) => ({
            x: i * 2,
            y: velocity(i * 2, km, vmax, inhibitor, ki, mode),
          })),
        },
        ...(mode === "none"
          ? []
          : [
              {
                xLabel: "[S] / Km",
                yLabel: "IC50 / µM",
                points: Array.from({ length: 100 }, (_, i) => ({
                  x: (i + 1) / 10,
                  y: ic50((i + 1) / 10, ki, mode),
                })),
              },
            ]),
        {
          title: "Lineweaver–Burk 双倒数图",
          xLabel: "1/[S] / µM⁻¹",
          yLabel: "1/v / min·µM⁻¹",
          points: Array.from({ length: 51 }, (_, i) => ({
            x: i / 50,
            y: (p.km / p.vmax) * (i / 50) + 1 / p.vmax,
          })),
        },
      ],
      tables: [
        {
          caption:
            "当前 Ki = " +
            ki +
            " µM：三种模式在三个 [S]/Km 下的 IC50（µM），Ki 取各自结合的那种酶形式的解离常数。",
          columns: ["模式", ...[0.1, 1, 10].map((r) => "[S]/Km = " + r)],
          rows: bioModes
            .slice(1)
            .map(([m, label]) => [
              m === "noncompetitive" ? label + "（α = 1）" : label,
              ...[0.1, 1, 10].map((r) => ic50(r, ki, m).toFixed(2)),
            ]),
        },
      ],
    };
  },
};
const bioPermeability: LabModel = {
  inputs: [
    {
      id: "kind",
      label: "单一电离中心",
      kind: "select",
      default: "base",
      options: [
        { value: "base", label: "弱碱 B / BH⁺" },
        { value: "acid", label: "弱酸 HA / A⁻" },
      ],
    },
    numberInput("pKa", "pKa", 2, 12, 0.1, 8),
    numberInput("logP", "logP", -2, 6, 0.1, 2),
    numberInput("pH", "环境 pH", 0, 14, 0.1, 7.4),
  ],
  run({
    kind,
    pKa,
    logP,
    pH,
  }: {
    kind: string;
    pKa: number;
    logP: number;
    pH: number;
  }) {
    return {
      summary:
        "中性分子分数 " +
        (100 * neutralFraction(pH, pKa, kind)).toFixed(2) +
        "%；相对渗透指数 " +
        permeability(pH, pKa, logP, kind).toFixed(4) +
        "（无量纲）。",
      charts: [
        {
          xLabel: "pH",
          yLabel: "相对渗透指数",
          points: Array.from({ length: 71 }, (_, i) => ({
            x: i / 5,
            y: permeability(i / 5, pKa, logP, kind),
          })),
        },
      ],
    };
  },
};
/** Two-state teaching model; all rates min^-1, time min, total Ras conserved. */
export function signalingRasSteady(
  gef: number,
  gap: number,
  intrinsic: number,
) {
  const sum = gef + gap + intrinsic;
  return sum === 0 ? null : gef / sum;
}
export function rasFraction(
  t: number,
  gef: number,
  gap: number,
  intrinsic: number,
  initial = 0,
) {
  const steady = signalingRasSteady(gef, gap, intrinsic);
  return steady === null
    ? initial
    : steady + (initial - steady) * Math.exp(-(gef + gap + intrinsic) * t);
}
/** Illustrative exponential growth: V0 mm^3; k day^-1; t days; effect 0..1. */
export function tumorVolume(v0: number, k: number, t: number, effect = 0) {
  return v0 * Math.exp(k * (1 - effect) * t);
}
/** Delta-volume definition. No control growth means TGI is undefined. */
export function tumorTgi(v0: number, k: number, t: number, effect: number) {
  const controlGrowth = v0 * Math.expm1(k * t);
  return controlGrowth === 0
    ? null
    : 100 * (1 - (v0 * Math.expm1(k * (1 - effect) * t)) / controlGrowth);
}

const signalingRas: LabModel = {
  inputs: [
    numberInput("gef", "GEF 速率（min⁻¹）", 0, 1, 0.01, 0.3),
    numberInput("gap", "GAP 速率（min⁻¹）", 0, 1, 0.01, 0.6),
    numberInput("intrinsic", "固有水解速率（min⁻¹）", 0, 0.2, 0.01, 0.02),
  ],
  run({
    gef,
    gap,
    intrinsic,
  }: {
    gef: number;
    gap: number;
    intrinsic: number;
  }) {
    const steady = signalingRasSteady(gef, gap, intrinsic);
    return {
      summary:
        "Ras-GTP 稳态分数：" +
        (steady === null ? "无唯一稳态" : steady.toFixed(3)),
      readouts: [
        {
          label: "60 min 时",
          value:
            rasFraction(60, gef, gap, intrinsic).toFixed(3) +
            "。三项速率都为零时，无唯一稳态，分数保持初始值。",
        },
      ],
      charts: [
        {
          xLabel: "时间 / min",
          yLabel: "Ras-GTP 分数",
          points: Array.from({ length: 61 }, (_, x) => ({
            x,
            y: rasFraction(x, gef, gap, intrinsic),
          })),
        },
      ],
    };
  },
};
const signalingTumor: LabModel = {
  inputs: [
    numberInput("v0", "起始体积（mm³）", 50, 200, 10, 100),
    numberInput("k", "对照增长率（day⁻¹）", 0, 0.12, 0.01, 0.08),
    numberInput("effect", "效应（无单位）", 0, 1, 0.05, 0.5),
    numberInput("day", "比较时间（天）", 0, 28, 1, 28),
  ],
  run({
    v0,
    k,
    effect,
    day,
  }: {
    v0: number;
    k: number;
    effect: number;
    day: number;
  }) {
    const tgi = tumorTgi(v0, k, day, effect);
    return {
      summary:
        "第 " +
        day +
        " 天：对照 " +
        tumorVolume(v0, k, day).toFixed(1) +
        " mm³，治疗 " +
        tumorVolume(v0, k, day, effect).toFixed(1) +
        " mm³；TGI " +
        (tgi === null ? "未定义（对照无净增长）" : tgi.toFixed(1) + "%"),
      charts: [
        {
          title: "对照组",
          xLabel: "时间 / 天",
          yLabel: "体积 / mm³",
          points: Array.from({ length: 29 }, (_, x) => ({
            x,
            y: tumorVolume(v0, k, x),
          })),
        },
        {
          title: "治疗组",
          xLabel: "时间 / 天",
          yLabel: "体积 / mm³",
          points: Array.from({ length: 29 }, (_, x) => ({
            x,
            y: tumorVolume(v0, k, x, effect),
          })),
        },
      ],
    };
  },
};
/** nM and minutes. Rapid equilibrium, excess inhibitor, constant free concentration. */
export function inactivationRate(
  concentration: number,
  KI: number,
  kinact: number,
) {
  return (kinact * concentration) / (KI + concentration);
}
/** No resynthesis or depletion; fraction inactivated from initially active protein. */
export function inactivated(rate: number, minutes: number) {
  return -Math.expm1(-rate * minutes);
}
/** After complete washout: no rebinding. For covalent protein, rate is turnover; reversible: koff. */
export function remaining(initial: number, rate: number, minutes: number) {
  return initial * Math.exp(-rate * minutes);
}
export function residence(koff: number) {
  return 1 / koff;
}

const covalentInactivation: LabModel = {
  inputs: [
    numberInput("concentration", "游离抑制剂 [I]（nM）", 0, 1000, 10, 100),
    numberInput("KI", "KI（nM）", 10, 500, 10, 100),
    numberInput("kinact", "kinact（min⁻¹）", 0.01, 0.3, 0.01, 0.1),
  ],
  run({
    concentration,
    KI,
    kinact,
  }: {
    concentration: number;
    KI: number;
    kinact: number;
  }) {
    const rate = inactivationRate(concentration, KI, kinact);
    return {
      summary:
        "kobs=" +
        rate.toFixed(4) +
        " min⁻¹；60 min 失活 " +
        (100 * inactivated(rate, 60)).toFixed(1) +
        "%。",
      charts: [
        {
          xLabel: "时间 / min",
          yLabel: "失活 / %",
          points: Array.from({ length: 61 }, (_, x) => ({
            x,
            y: 100 * inactivated(rate, x),
          })),
        },
      ],
    };
  },
};
const bindingDissociation: LabModel = {
  inputs: [
    {
      id: "mode",
      label: "教学情境",
      kind: "select",
      default: "reversible",
      options: [
        { value: "reversible", label: "可逆复合物解离" },
        { value: "covalent", label: "共价加合物随蛋白周转消退" },
      ],
    },
    numberInput("koff", "koff（min⁻¹）", 0.01, 0.3, 0.01, 0.1),
  ],
  run({ mode, koff }: { mode: string; koff: number }) {
    const rate = mode === "reversible" ? koff : 0.005;
    return {
      summary:
        "60 min 剩余占据：" +
        (100 * remaining(0.9, rate, 60)).toFixed(1) +
        "%。" +
        (mode === "reversible"
          ? "τ=" + residence(koff).toFixed(1) + " min。"
          : ""),
      charts: [
        {
          xLabel: "洗脱后时间 / min",
          yLabel: "占据 / %",
          points: Array.from({ length: 61 }, (_, x) => ({
            x,
            y: 100 * remaining(0.9, rate, x),
          })),
        },
      ],
    };
  },
};
export const biochemicalKineticsModels: Record<string, LabModel> = {
  "covalent-inactivation": covalentInactivation,
  "binding-dissociation": bindingDissociation,
  "signaling-ras": signalingRas,
  "signaling-tumor": signalingTumor,
  "bio-scale": bioScale,
  "bio-ionization": bioIonization,
  "bio-binding": bioBinding,
  "bio-enzyme": bioEnzyme,
  "bio-permeability": bioPermeability,
  "degradation-dose-response": degradationDoseResponse,
  "protein-turnover": proteinTurnover,
  "protein-loss-curve": proteinLossCurve,
  "first-order-elimination": firstOrderElimination,
  "gtpase-steady-state": gtpaseSteadyState,
  "covalent-engagement": covalentEngagement,
  "atp-competition": atpCompetition,
  "assay-panel-ratio": assayPanel,
};
