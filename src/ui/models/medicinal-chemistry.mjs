import { defineDataTable, withAlternateValues } from "../data/values.ts";
/** nM throughout. Reversible competitive inhibition, equilibrium, negligible ligand depletion. */
export function chengPrusoff(ic50, substrateOverKm) {
  if (
    !Number.isFinite(ic50) ||
    ic50 <= 0 ||
    !Number.isFinite(substrateOverKm) ||
    substrateOverKm < 0
  )
    throw new Error("IC50 必须大于 0，[S]/Km 必须非负且有限");
  return ic50 / (1 + substrateOverKm);
}

/** Empirical increasing response; concentration and midpoint use the same unit. */
export function hill(concentration, midpoint, slope, maximum = 100) {
  if (
    ![concentration, midpoint, slope, maximum].every(Number.isFinite) ||
    concentration < 0 ||
    midpoint <= 0 ||
    slope <= 0 ||
    maximum < 0
  )
    throw new Error("浓度和最大效应必须非负，中点浓度和 Hill 系数必须大于 0");
  if (concentration === 0) return 0;
  return (
    maximum /
    (1 + Math.exp(slope * (Math.log(midpoint) - Math.log(concentration))))
  );
}

export function pIC50(nanomolar) {
  if (!Number.isFinite(nanomolar) || nanomolar <= 0)
    throw new Error("IC50 必须为正的有限 nM 值");
  return 9 - Math.log10(nanomolar);
}

/** Teaching screen, not a hypothesis test: independent log-scale means, 2 standard errors. */
export function comparePotency(a, b, sdA, sdB, nA, nB, meaningfulDelta = 0.5) {
  const delta = Math.abs(pIC50(a) - pIC50(b));
  if (
    ![sdA, sdB, meaningfulDelta].every((x) => Number.isFinite(x) && x >= 0) ||
    ![nA, nB].every((x) => Number.isInteger(x) && x >= 2)
  )
    throw new Error("标准差和意义阈值必须非负；每组至少两次独立重复");
  const standardError = Math.sqrt(sdA ** 2 / nA + sdB ** 2 / nB);
  return {
    delta,
    standardError,
    threshold: 2 * standardError,
    exceedsNoise: delta > 2 * standardError,
    meaningful: delta >= meaningfulDelta,
  };
}

/** Instantaneous free plasma concentration only; no tissue or target-occupancy inference. */
export function freeConcentration(total, fraction) {
  if (
    !Number.isFinite(total) ||
    total < 0 ||
    !Number.isFinite(fraction) ||
    fraction < 0 ||
    fraction > 1
  )
    throw new Error("总浓度必须非负，游离分数须在 0–1 之间");
  return total * fraction;
}

/** How many times higher the larger value is than the smaller one; both in the same unit. */
export function foldChange(a, b) {
  if (![a, b].every((x) => Number.isFinite(x) && x > 0))
    throw new Error("两个值都必须是正的有限数");
  return Math.max(a, b) / Math.min(a, b);
}

/** |ΔpIC50| between two potencies in the same unit. */
export function deltaPIC50(a, b) {
  return Math.log10(foldChange(a, b));
}

/**
 * Ratio of the inhibitor concentrations at two inhibition levels on a Hill
 * curve, `100 / (1 + (IC50/[I])^h)`; the levels are fractions between 0 and 1.
 */
export function concentrationSpan(low, high, slope = 1) {
  if (!(0 < low && low < high && high < 1) || !(slope > 0))
    throw new Error("抑制分数须满足 0 < 低 < 高 < 1，Hill 系数须大于 0");
  return (high / (1 - high) / (low / (1 - low))) ** (1 / slope);
}

/** AUC after an intravenous dose from clearance: mg/kg and mL/min/kg in, h·µg/mL out. */
export function aucFromClearance(doseMgPerKg, clearanceMlPerMinPerKg) {
  if (![doseMgPerKg, clearanceMlPerMinPerKg].every((x) => x > 0))
    throw new Error("剂量与清除率必须为正");
  return (doseMgPerKg * 1000) / (clearanceMlPerMinPerKg * 60);
}

/** Oral bioavailability as a fraction, from the dose-normalised AUCs of the two routes. */
export function bioavailability(aucOral, doseOral, aucIv, doseIv) {
  if (![aucOral, doseOral, aucIv, doseIv].every((x) => x > 0))
    throw new Error("AUC 与剂量必须为正");
  return aucOral / doseOral / (aucIv / doseIv);
}

const range = (id, label, min, max, step, value, unit) => ({
  id,
  label,
  kind: "number",
  control: "range",
  min,
  max,
  step,
  default: value,
  ...(unit ? { unit } : {}),
});
/** @type {Record<string, import('./catalog.mjs').LabModel>} */
export const medicinalChemistryModels = {
  "data-literacy-constants": {
    inputs: [range("ratio", "底物与 Km 比值", 0, 20, 0.5, 1)],
    run({ ratio }) {
      return {
        summary: `固定 Ki = 10 nM；IC50 = ${(10 * (1 + ratio)).toFixed(1)} nM；反算 Ki = ${chengPrusoff(10 * (1 + ratio), ratio).toFixed(1)} nM。`,
        charts: [
          {
            xLabel: "[S]/Km",
            yLabel: "IC50 / nM",
            points: Array.from({ length: 21 }, (_, x) => ({
              x,
              y: 10 * (1 + x),
            })),
          },
        ],
      };
    },
  },
  "data-literacy-error": {
    inputs: [
      range("b", "B 的 IC50", 3, 30, 1, 5, "nM"),
      range("n", "独立重复次数", 2, 30, 1, 3),
      range("sd", "pIC50 标准差", 0.05, 0.5, 0.05, 0.2),
    ],
    run({ b, n, sd }) {
      const r = comparePotency(3, b, sd, sd, n, n);
      return {
        summary: `A/B 的 pIC50：${pIC50(3).toFixed(3)} / ${pIC50(b).toFixed(3)}；差值 ${r.delta.toFixed(3)}；2SE = ${r.threshold.toFixed(3)}。${r.exceedsNoise ? "超过教学误差线" : "尚未超过教学误差线"}；${r.meaningful ? "达到" : "未达到"}预设实际意义阈值 0.5 pIC50。`,
      };
    },
  },
  "data-literacy-dose-response": {
    inputs: [
      range("slope", "Hill 系数", 0.5, 4, 0.5, 1),
      range("midpoint", "效应中点", 1, 100, 1, 10, "nM"),
      range("maximum", "最大效应", 20, 100, 10, 100, "%"),
    ],
    run({ slope, midpoint, maximum }) {
      return {
        summary: `在 C=EC50=${midpoint} nM 时，响应为 ${maximum / 2}%；在 10 nM 时为 ${hill(10, midpoint, slope, maximum).toFixed(1)}%。`,
        charts: [
          {
            xLabel: "log10(C / nM)，0=1 nM，3=1000 nM",
            yLabel: "响应 / %",
            points: Array.from({ length: 61 }, (_, i) => ({
              x: i / 20,
              y: hill(10 ** (i / 20), midpoint, slope, maximum),
            })),
          },
        ],
      };
    },
  },
  "data-literacy-in-vivo": {
    inputs: [
      range("total", "总血浆浓度", 100, 3000, 100, 1000, "nM"),
      range("fu", "游离分数", 1, 100, 1, 1, "%"),
    ],
    run({ total, fu }) {
      return {
        summary: `游离血浆浓度估计 ${freeConcentration(total, fu / 100).toFixed(1)} nM；对照教学体外 IC50=30 nM。`,
      };
    },
  },
};

/** NIST representative natural compositions. Nominal mass offsets; no C/H/O contribution. */
const isotopes = {
  Cl: [
    [0, 0.7576],
    [2, 0.2424],
  ],
  Br: [
    [0, 0.5069],
    [2, 0.4931],
  ],
  S: [
    [0, 0.9499],
    [1, 0.0075],
    [2, 0.0425],
    [4, 0.0001],
  ],
};

export function isotopePattern(element, count) {
  if (
    !Object.hasOwn(isotopes, element) ||
    !Number.isInteger(count) ||
    count < 0 ||
    count > 8
  )
    throw new Error("元素须为 Cl/Br/S，原子数须为 0–8 的整数");
  let distribution = [1];
  for (let i = 0; i < count; i++) {
    const next = Array(distribution.length + (element === "S" ? 4 : 2)).fill(0);
    distribution.forEach((p, offset) => {
      for (const [shift, probability] of isotopes[element])
        next[offset + shift] += p * probability;
    });
    distribution = next;
  }
  const max = Math.max(...distribution);
  return distribution
    .map((probability, offset) => ({
      offset,
      probability,
      intensity: (100 * probability) / max,
    }))
    .filter((p) => p.probability > 0);
}
export const PROTON = 1.007276466621;
export const SODIUM = 22.989218;

/** Input: neutral monoisotopic mass in u. Output: positive-ion m/z. */
export function adductMz(mass, adduct) {
  if (!Number.isFinite(mass) || mass <= 0 || mass > 10000)
    throw new Error("中性单同位素质量须为 0–10000 u（不含 0）");
  if (adduct === "H") return mass + PROTON;
  if (adduct === "Na") return mass + SODIUM;
  if (adduct === "2H") return (mass + 2 * PROTON) / 2;
  throw new Error("未知加合离子");
}

medicinalChemistryModels["spectra-mass"] = {
  inputs: [
    {
      id: "element",
      label: "元素",
      kind: "select",
      options: ["Cl", "Br", "S"].map((value) => ({ value, label: value })),
      default: "Cl",
    },
    {
      id: "count",
      label: "原子数（0–8）",
      kind: "number",
      min: 0,
      max: 8,
      step: 1,
      default: 1,
    },
    {
      id: "mass",
      label: "中性单同位素质量 / u",
      kind: "number",
      min: 0.001,
      max: 10000,
      step: 0.1,
      default: 300,
    },
    {
      id: "adduct",
      label: "离子式",
      kind: "select",
      options: [
        { value: "H", label: "[M+H]⁺" },
        { value: "Na", label: "[M+Na]⁺" },
        { value: "2H", label: "[M+2H]²⁺" },
      ],
      default: "H",
    },
  ],
  run({ element, count, mass, adduct }) {
    if (count === "" || mass === "") throw new Error("请填写原子数与中性质量");
    const peaks = isotopePattern(element, Number(count)),
      mz = adductMz(Number(mass), adduct);
    return {
      summary: `计算 m/z：${mz.toFixed(6)}`,
      charts: [
        {
          xLabel: "名义质量偏移 / u",
          yLabel: "相对强度 / %",
          points: peaks.flatMap((p) => [
            { x: p.offset, y: 0 },
            { x: p.offset, y: p.intensity },
            { x: p.offset, y: 0 },
          ]),
        },
      ],
      tables: [
        {
          caption: "选定元素同位素分布",
          columns: ["名义质量差 / u", "概率 / %", "相对强度 / %"],
          rows: peaks.map((p) => [
            `+${p.offset}`,
            (100 * p.probability).toFixed(4),
            p.intensity.toFixed(2),
          ]),
        },
      ],
    };
  },
};

/** Spearman rank correlation with tied ranks averaged. */
export function spearman(pairs) {
  const n = pairs.length;
  if (n < 3) return { rho: null, n };
  const ranks = (values) => {
    const order = values.map((_, i) => i).sort((a, b) => values[a] - values[b]);
    const out = new Array(values.length);
    for (let i = 0; i < order.length;) {
      let j = i;
      while (j + 1 < order.length && values[order[j + 1]] === values[order[i]])
        j++;
      for (let k = i; k <= j; k++) out[order[k]] = (i + j) / 2 + 1;
      i = j + 1;
    }
    return out;
  };
  const x = ranks(pairs.map((p) => p[0]));
  const y = ranks(pairs.map((p) => p[1]));
  const mean = (values) => values.reduce((a, b) => a + b, 0) / n;
  const mx = mean(x);
  const my = mean(y);
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < n; i++) {
    cov += (x[i] - mx) * (y[i] - my);
    vx += (x[i] - mx) ** 2;
    vy += (y[i] - my) ** 2;
  }
  if (vx === 0 || vy === 0) return { rho: null, n };
  return { rho: cov / Math.sqrt(vx * vy), n };
}

const exact = (row, key) => {
  const cell = row.values[key];
  return cell && cell.op === "=" ? cell.value : undefined;
};

/**
 * Rank correlation of two columns over the compounds that have an exact
 * (uncensored) value in every column of `among`, so that columns compared
 * with each other are compared on the same compounds.
 */
export function columnCorrelation(rows, a, b, among = [a, b]) {
  const pairs = [];
  for (const row of rows) {
    if (!among.every((key) => exact(row, key) !== undefined)) continue;
    pairs.push([exact(row, a), exact(row, b)]);
  }
  return spearman(pairs);
}

/** How many times larger `to` is than `from` for one column; undefined when either is missing or censored. */
export function assayFoldChange(from, to, key) {
  const left = exact(from, key);
  const right = exact(to, key);
  if (left === undefined || right === undefined || left === 0) return undefined;
  return right / left;
}

medicinalChemistryModels["assay-correlation"] = {
  validateData(data) {
    const text = (v) => typeof v === "string" && v.trim().length > 0;
    if (!data || !Array.isArray(data.columns) || !Array.isArray(data.rows))
      throw new Error("缺少相关性数据表");
    const table = defineDataTable(data);
    if (!table.columns.every((c) => text(c.key) && text(c.label)))
      throw new Error("相关性数据列须有键名和标签");
    const keys = new Set(table.columns.map((c) => c.key));
    const config = data.correlation;
    if (!config || !keys.has(config.defaultX) || !keys.has(config.defaultY))
      throw new Error("相关性默认轴须指向数据列");
    const cohort = config.cohort;
    if (
      !cohort ||
      !Array.isArray(cohort.keys) ||
      cohort.keys.length < 2 ||
      new Set(cohort.keys).size !== cohort.keys.length ||
      !cohort.keys.every((k) => keys.has(k)) ||
      !text(cohort.description)
    )
      throw new Error("共同样本组须有至少两个唯一数据列及说明");
    if (
      !data.alternates ||
      !text(data.alternates.alternate) ||
      !text(data.alternates.listed)
    )
      throw new Error("相关性比较须提供两套来源标签");
  },
  inputs: (data) => [
    {
      id: "x",
      label: "秩相关横轴",
      kind: "select",
      options: data.columns.map((c) => ({ value: c.key, label: c.label })),
      default: data.correlation.defaultX,
    },
    {
      id: "y",
      label: "秩相关纵轴",
      kind: "select",
      options: data.columns.map((c) => ({ value: c.key, label: c.label })),
      default: data.correlation.defaultY,
    },
    {
      id: "agreedOnly",
      label: "秩相关取值",
      kind: "select",
      options: [
        { value: "yes", label: "只用两处写法一致的化合物" },
        {
          value: "no",
          label: `${data.alternates.alternate}与 ${data.alternates.listed}`,
        },
      ],
      default: "yes",
    },
  ],
  run({ x, y, agreedOnly }, data) {
    const table = defineDataTable(data),
      cohort = data.correlation.cohort;
    const shared = cohort.keys.includes(x) && cohort.keys.includes(y);
    const among = shared ? cohort.keys : [x, y];
    const corr = (rows) => columnCorrelation(rows, x, y, among);
    const rho = (r) =>
      r.rho === null ? "算不出" : `${r.rho.toFixed(2)}（n = ${r.n}）`;
    const text =
      agreedOnly === "yes"
        ? `Spearman ρ = ${rho(corr(table.rows.filter((row) => !Object.values(row.values).some((cell) => cell.alternate))))}，不受上面取值的影响。`
        : `Spearman ρ：${table.alternates.alternate} ${rho(corr(withAlternateValues(table.rows)))}；${table.alternates.listed} ${rho(corr(table.rows))}。`;
    return {
      summary:
        text +
        `只用${shared ? cohort.description : "两列都有确切值"}的化合物。`,
    };
  },
};

// The numbers the chapters quote, and the arithmetic that ties them together.
// The topic content data holds every printed value with its source; these
// pure functions retain the arithmetic used to prepare its tables.

const MONOISOTOPIC = {
  C: 12,
  H: 1.00782503207,
  N: 14.0030740048,
  O: 15.99491461956,
  S: 31.972071,
  Cl: 34.96885268,
};
const AVERAGE = {
  C: 12.011,
  H: 1.008,
  N: 14.007,
  O: 15.999,
  S: 32.06,
  Cl: 35.45,
};

/** `C49H60ClN9O8S2` as element counts. */
export function parseFormula(formula) {
  const counts = {};
  for (const [, element, count] of formula.matchAll(/([A-Z][a-z]?)(\d*)/g)) {
    if (!(element in AVERAGE))
      throw new Error(`Unknown element in ${formula}: ${element}`);
    counts[element] = (counts[element] ?? 0) + (count ? Number(count) : 1);
  }
  return counts;
}
function mass(formula, table) {
  return Object.entries(parseFormula(formula)).reduce(
    (sum, [element, count]) => sum + table[element] * count,
    0,
  );
}
export const monoisotopicMass = (formula) => mass(formula, MONOISOTOPIC);
export const averageMass = (formula) => mass(formula, AVERAGE);

/** Cooperativity as Gadd defines it: Kd of MZ1 for VCB over Kd of VCB for the MZ1–bromodomain complex. */
export const alphaFromKd = (binaryKd, ternaryKd) => binaryKd / ternaryKd;
/** How many times the larger of two values is the smaller. */
export const fold = (a, b) => Math.max(a, b) / Math.min(a, b);
/** Share of a theoretical amount, in percent: `mg` of a product of molar mass `mw` against `umol` of the limiting reagent. */
export const percentOfLimiting = (mg, mw, umol) =>
  (100 * ((mg / mw) * 1000)) / umol;
/** AB-MPS as Edmondson writes it: |cLogD − 3| + aromatic rings + rotatable bonds. */
export const abMps = (clogd, nar, nrotb) => Math.abs(clogd - 3) + nar + nrotb;

export const designMath = (() => {
  /** IC50 in nM. The logarithm always uses a molar concentration. */
  function pIC50(ic50NM) {
    if (!Number.isFinite(ic50NM) || ic50NM <= 0)
      throw new RangeError("IC50 必须是有限正数（nM）");
    return 9 - Math.log10(ic50NM);
  }

  /** Teaching LE proxy at about 300 K, kcal·mol⁻¹ per heavy atom.
   * Compare only the same assay; IC50 is not a thermodynamic Kd.
   */
  function ligandEfficiency(ic50NM, heavyAtoms) {
    if (!Number.isInteger(heavyAtoms) || heavyAtoms <= 0)
      throw new RangeError("重原子数必须是正整数");
    return (1.37 * pIC50(ic50NM)) / heavyAtoms;
  }

  /** Dimensionless LipE; callers must label whether logP or logD was used. */
  function lipophilicEfficiency(ic50NM, logP) {
    if (!Number.isFinite(logP))
      throw new RangeError("亲脂性参数必须是有限数值");
    return pIC50(ic50NM) - logP;
  }

  /** Monoprotic base, only neutral species partitions into octanol.
   * Ignores ion pairing, charged-species partition and multiple ionizations.
   */
  function baseLogD(logP, pKa, pH) {
    if (![logP, pKa, pH].every(Number.isFinite))
      throw new RangeError("logP、pKa 与 pH 必须是有限数值");
    const exponent = pKa - pH;
    const correction =
      exponent > 0
        ? exponent + Math.log10(1 + 10 ** -exponent)
        : Math.log10(1 + 10 ** exponent);
    return logP - correction;
  }

  return { pIC50, ligandEfficiency, lipophilicEfficiency, baseLogD };
})();

medicinalChemistryModels["design-efficiency"] = {
  inputs: [
    {
      id: "concentration",
      label: "IC50（nM）",
      kind: "number",
      min: Number.MIN_VALUE,
      max: Number.MAX_VALUE,
      default: 10,
    },
    {
      id: "count",
      label: "重原子数",
      kind: "number",
      min: 1,
      max: Number.MAX_SAFE_INTEGER,
      step: 1,
      default: 30,
    },
    {
      id: "lipophilicity",
      label: "logP（无量纲）",
      kind: "number",
      min: -Number.MAX_VALUE,
      max: Number.MAX_VALUE,
      default: 3,
    },
  ],
  run({ concentration, count, lipophilicity }) {
    return {
      summary: `pIC50 ${designMath.pIC50(concentration).toFixed(2)}；LE ${designMath.ligandEfficiency(concentration, count).toFixed(3)} kcal·mol⁻¹·重原子⁻¹；LipE(logP) ${designMath.lipophilicEfficiency(concentration, lipophilicity).toFixed(2)}。`,
    };
  },
};
medicinalChemistryModels["design-pka"] = {
  inputs: [
    range("pKa", "共轭酸 pKa", 3, 12, 0.1, 9),
    range("logP", "中性形式 logP", -1, 6, 0.1, 3),
    range("pH", "pH", 1, 10, 0.1, 7.4),
  ],
  run({ pKa, logP, pH }) {
    return {
      summary: `模型 logD${pH} = ${designMath.baseLogD(logP, pKa, pH).toFixed(2)}`,
    };
  },
};

export const drugActionMath = (() => {
  /** Teaching models: free concentrations in nM, time in minutes, energy in kcal/mol.
   * Equilibrium models assume one homogeneous site and negligible ligand depletion.
   * Covalent model assumes constant free inhibitor, no enzyme synthesis or recovery.
   */
  const R = 0.00198720425864083;
  const TEMPERATURE = 298;
  function occupancy(concentration, kd) {
    return concentration / (kd + concentration);
  }
  function hill(concentration, ec50, emax, n) {
    return (emax * concentration ** n) / (ec50 ** n + concentration ** n);
  }
  function doseRatio(antagonist, kb) {
    return 1 + antagonist / kb;
  }
  function competitiveIC50(ki, substrateKm) {
    return ki * (1 + substrateKm);
  }
  /** Pure noncompetitive inhibition: equal affinity for E and ES. */
  function noncompetitiveIC50(ki) {
    return ki;
  }
  /** Apparent Ki of a reversible competitive inhibitor: Kd(1 + [S]/Km), [S] and Km in the same unit. */
  function apparentKi(kd, km, substrate) {
    return kd * (1 + substrate / km);
  }
  function kiFromIC50(ic50, substrateKm) {
    return ic50 / (1 + substrateKm);
  }
  function kobs(inhibitor, ki, kinact) {
    return (kinact * inhibitor) / (ki + inhibitor);
  }
  function remainingActivity(time, rate) {
    return Math.exp(-rate * time);
  }

  /**
   * Active fraction of an irreversibly inactivated target, sampled every `sampleEvery` hours up to `hours`.
   * Free inhibitor decays first-order, kobs = (kinact/KI)[I], and inactivated target is replaced by new
   * active protein at the target's turnover rate: da/dt = kdeg(1 − a) − kobs·a. One free-inhibitor
   * time course, no tissue distribution, no reversible binding.
   */
  function targetActivity(
    { c0, plasmaHalfLife, efficiency, turnoverHalfLife },
    hours,
    sampleEvery = 0.5,
  ) {
    const kdeg = Math.LN2 / turnoverHalfLife;
    const dt = 0.005;
    const perSample = Math.round(sampleEvery / dt);
    const points = [{ x: 0, y: 1 }];
    let a = 1;
    for (let i = 0; i < Math.round(hours / dt); i++) {
      const t = (i + 0.5) * dt;
      const rate = efficiency * c0 * 2 ** (-t / plasmaHalfLife) * 1e-9 * 3600;
      const lambda = kdeg + rate;
      if (lambda > 0) {
        const steady = kdeg / lambda;
        a = steady + (a - steady) * Math.exp(-lambda * dt);
      }
      if ((i + 1) % perSample === 0)
        points.push({ x: ((i + 1) / perSample) * sampleEvery, y: a });
    }
    return points;
  }
  function halfLife(rate) {
    return rate === 0 ? Infinity : Math.LN2 / rate;
  }
  function residenceTime(koff) {
    return 1 / koff;
  }
  /** Inclusive thresholds: target >=90%, off-target <=10%; 81-fold is one point. */
  function selectivityWindow(targetKd, offKd) {
    const lower = 9 * targetKd;
    const upper = offKd / 9;
    return lower <= upper ? { lower, upper } : null;
  }
  /** Analytic maximum of theta(target)-theta(off), for offKd > targetKd. */
  function largestGap(targetKd, offKd) {
    if (offKd <= targetKd) return null;
    const concentration = Math.sqrt(targetKd * offKd);
    return {
      concentration,
      difference:
        occupancy(concentration, targetKd) - occupancy(concentration, offKd),
    };
  }
  /** Standard state 1 mol/L: ln(Kd / 1 M). Input nM is converted to M. */
  function freeEnergy(kd) {
    return R * TEMPERATURE * Math.log(kd * 1e-9);
  }
  function kdFromEnergy(energy) {
    return Math.exp(energy / (R * TEMPERATURE)) * 1e9;
  }
  function ligandEfficiency(energy, heavyAtoms) {
    return -energy / heavyAtoms;
  }
  function lipophilicEfficiency(kd, logP) {
    return -Math.log10(kd * 1e-9) - logP;
  }
  function logSeries(min, max, fn) {
    return Array.from({ length: 81 }, (_, i) => {
      const x = min * (max / min) ** (i / 80);
      return { x, y: fn(x) };
    });
  }

  return {
    R,
    TEMPERATURE,
    occupancy,
    hill,
    doseRatio,
    competitiveIC50,
    noncompetitiveIC50,
    apparentKi,
    kiFromIC50,
    kobs,
    remainingActivity,
    targetActivity,
    halfLife,
    residenceTime,
    selectivityWindow,
    largestGap,
    freeEnergy,
    kdFromEnergy,
    ligandEfficiency,
    lipophilicEfficiency,
    logSeries,
  };
})();
const da = drugActionMath;
const drugChart = (title, points, xLabel, yLabel, log = false) => ({
  title,
  points: points.map((p) => ({ x: log ? Math.log10(p.x) : p.x, y: p.y })),
  xLabel: log ? `log10(${xLabel})` : xLabel,
  yLabel,
  xDomain: [
    Math.min(...points.map((p) => (log ? Math.log10(p.x) : p.x))),
    Math.max(...points.map((p) => (log ? Math.log10(p.x) : p.x))),
  ],
  ...(yLabel.includes("%") ? { yDomain: [0, 100] } : {}),
});
const numeric = (id, label, min, max, value, step) => ({
  id,
  label,
  kind: "number",
  min,
  max,
  default: value,
  ...(step ? { step } : {}),
});
for (const direction of ["kd", "energy"])
  medicinalChemistryModels[`drug-action-energy-${direction}`] = {
    inputs: [
      numeric(
        "input",
        direction === "kd" ? "Kd (nM)" : "ΔG (kcal/mol)",
        direction === "kd" ? 0.001 : -16.37,
        direction === "kd" ? 1e6 : -4.09,
        direction === "kd" ? 1 : da.freeEnergy(1),
      ),
      numeric("atoms", "重原子数 NHA", 1, 200, 25, 1),
      numeric("logP", "logP（无量纲）", -5, 10, 3),
    ],
    run({ input, atoms, logP }) {
      if (
        typeof input !== "number" ||
        !Number.isFinite(input) ||
        (direction === "kd"
          ? input < 0.001 || input > 1e6
          : input < -16.37 || input > -4.09)
      )
        throw new Error(
          "Kd 请输入 0.001–10⁶ nM；ΔG 请输入 −16.37 至 −4.09 kcal/mol。空白或无穷值不能换算。",
        );
      if (!Number.isInteger(atoms) || atoms < 1 || atoms > 200)
        throw new Error("重原子数须为 1–200 的整数。");
      if (
        typeof logP !== "number" ||
        !Number.isFinite(logP) ||
        logP < -5 ||
        logP > 10
      )
        throw new Error("logP 请输入 −5 至 10 的有限数值。");
      const kd = direction === "kd" ? input : da.kdFromEnergy(input),
        energy = direction === "kd" ? da.freeEnergy(input) : input;
      return {
        summary: `Kd = ${kd.toPrecision(5)} nM；ΔG = ${energy.toFixed(4)} kcal/mol。LE = ${da.ligandEfficiency(energy, atoms).toFixed(3)} kcal·mol⁻¹·重原子⁻¹。LLE（pKd−logP）= ${da.lipophilicEfficiency(kd, logP).toFixed(3)}。`,
      };
    },
  };
medicinalChemistryModels["drug-action-dose"] = {
  inputs: [
    range("ec50", "EC50", 1, 100, 1, 10, "nM"),
    range("emax", "Emax", 10, 100, 1, 100, "% 参照响应"),
    range("n", "Hill n", 0.5, 3, 0.1, 1),
    range("b", "拮抗剂浓度 [B]", 0, 1000, 10, 0, "nM"),
    range("kb", "拮抗剂 KB", 1, 100, 1, 10, "nM"),
  ],
  run({ ec50, emax, n, b, kb }) {
    const ratio = da.doseRatio(b, kb),
      shifted = ec50 * ratio;
    return {
      summary: `剂量比 r = ${ratio.toFixed(2)}；加入拮抗剂后 EC50 = ${shifted.toFixed(2)} nM；Emax = ${emax}%。在 C = ${ec50} nM 时，响应由 ${(emax / 2).toFixed(2)}% 变为 ${da.hill(ec50, shifted, emax, n).toFixed(2)}%。`,
      charts: [ec50, shifted].map((e, i) =>
        drugChart(
          i ? "加入拮抗剂" : "无拮抗剂",
          da.logSeries(0.01, 100000, (c) => da.hill(c, e, emax, n)),
          "游离激动剂 C / nM",
          "响应 (%)",
          true,
        ),
      ),
    };
  },
};
medicinalChemistryModels["atp-selectivity"] = {
  validateData(data) {
    if (!data || !Array.isArray(data.variants) || data.variants.length === 0)
      throw new Error("缺少激酶数据");
    const text = (v) => typeof v === "string" && v.trim().length > 0;
    const names = new Set();
    for (const variant of data.variants) {
      if (
        !variant ||
        !text(variant.name) ||
        names.has(variant.name) ||
        ![variant.kd, variant.km].every((v) => Number.isFinite(v) && v > 0)
      )
        throw new Error("激酶名称须唯一，Kd 和 Km 须为有限正数");
      names.add(variant.name);
    }
    if (
      !data.comparison ||
      !names.has(data.comparison.numerator) ||
      !names.has(data.comparison.denominator) ||
      data.comparison.numerator === data.comparison.denominator
    )
      throw new Error("比较角色须指向两个不同的激酶");
    if (
      !text(data.caption) ||
      !Array.isArray(data.columns) ||
      data.columns.length !== 5 ||
      !data.columns.every(text)
    )
      throw new Error("缺少表格标题或列名");
  },
  inputs: [range("exponent", "log10 [ATP / µM]", 0, 4, 0.25, 3)],
  run({ exponent }, data) {
    const atp = 10 ** exponent,
      fmt = (x) => (x >= 100 ? x.toFixed(0) : x.toPrecision(3));
    const rows = data.variants.map((v) => ({
        ...v,
        ratio: atp / v.km,
        ki: da.apparentKi(v.kd, v.km, atp),
      })),
      fold =
        rows.find((r) => r.name === data.comparison.numerator).ki /
        rows.find((r) => r.name === data.comparison.denominator).ki;
    return {
      summary: `[ATP] = ${fmt(atp)} µM 时，${data.comparison.numerator} 的表观 Ki 是 ${data.comparison.denominator} 的 ${fold.toFixed(1)} 倍。`,
      tables: [
        {
          caption: data.caption,
          columns: data.columns,
          rows: rows.map((r) => [
            r.name,
            String(r.kd),
            String(r.km),
            fmt(r.ratio),
            fmt(r.ki),
          ]),
        },
      ],
    };
  },
};
medicinalChemistryModels["drug-action-enzyme"] = {
  inputs: [
    range("ki", "Ki", 1, 100, 1, 5, "nM"),
    range("ratio", "底物比 [S]/Km", 0, 20, 0.5, 1),
    numeric("measured", "待换算的实测 IC50 (nM)", Number.MIN_VALUE, 1e9, 80),
  ],
  run({ ki, ratio, measured }) {
    if (
      typeof measured !== "number" ||
      !Number.isFinite(measured) ||
      measured <= 0 ||
      measured > 1e9
    )
      throw new Error("请输入大于 0、且不超过 10⁹ nM 的 IC50。");
    return {
      summary: `竞争性表观 IC50 = ${da.competitiveIC50(ki, ratio).toFixed(2)} nM；纯非竞争性对照 IC50 = ${da.noncompetitiveIC50(ki).toFixed(2)} nM。在当前底物比下，推算 Ki = ${da.kiFromIC50(measured, ratio).toFixed(3)} nM。`,
      charts: [
        drugChart(
          "底物竞争",
          Array.from({ length: 41 }, (_, i) => ({
            x: i / 2,
            y: da.competitiveIC50(ki, i / 2),
          })),
          "[S]/Km（无量纲）",
          "竞争性 IC50 (nM)",
        ),
      ],
    };
  },
};
medicinalChemistryModels["drug-action-selectivity"] = {
  inputs: [
    range("target", "主靶 Kd", 1, 100, 1, 10, "nM"),
    range("off", "脱靶 Kd", 10, 10000, 10, 1000, "nM"),
    range("max", "绘图浓度上限", 100, 100000, 100, 10000, "nM"),
    range("c", "观察浓度 C", 0, 10000, 10, 100, "nM"),
  ],
  run({ target, off, max, c }) {
    const window = da.selectivityWindow(target, off),
      gap = da.largestGap(target, off);
    return {
      summary: `选择性比 = ${(off / target).toFixed(2)}。C = ${c} nM 时，主靶 ${(da.occupancy(c, target) * 100).toFixed(2)}%，脱靶 ${(da.occupancy(c, off) * 100).toFixed(2)}%。${window ? `90%/10% 窗口：${window.lower.toFixed(2)}–${window.upper.toFixed(2)} nM${window.lower === window.upper ? "（仅一个边界点）" : ""}` : "无窗口"}。${gap ? `两条占有率的差在 C = ${gap.concentration.toFixed(2)} nM 最大，为 ${(gap.difference * 100).toFixed(2)} 个百分点。` : "脱靶亲和力不弱于主靶，没有主靶占有率优势。"}${window && window.upper > max ? "窗口部分或全部在当前绘图范围外；可增大绘图浓度上限。" : ""}`,
      charts: [target, off].map((kd, i) =>
        drugChart(
          i ? "脱靶占有率" : "主靶占有率",
          da.logSeries(0.1, max, (x) => 100 * da.occupancy(x, kd)),
          "游离浓度 / nM",
          "占有率 (%)",
          true,
        ),
      ),
    };
  },
};
medicinalChemistryModels["drug-action-turnover"] = {
  inputs: [
    range("c0", "初始游离浓度 C0", 10, 1000, 10, 100, "nM"),
    range("plasmaHalfLife", "药物半衰期", 0.1, 12, 0.1, 0.5, "h"),
    range("efficiency", "kinact/KI 效率", 1000, 100000, 100, 9900, "M⁻¹·s⁻¹"),
    range("turnoverHalfLife", "靶点更新半衰期", 2, 72, 1, 22, "h"),
  ],
  run(values) {
    const course = da.targetActivity(values, 72),
      lowest = course.reduce((best, p) => (p.y < best.y ? p : best)),
      at = (t) => (100 * course.find((p) => p.x === t).y).toFixed(0);
    return {
      summary: `最低活性 ${(100 * lowest.y).toFixed(0)}%（给药后 ${lowest.x.toFixed(1)} h）；给药后 2 h 活性 ${at(2)}%，24 h ${at(24)}%，48 h ${at(48)}%。`,
      charts: [
        drugChart(
          "活性靶点",
          course.map((p) => ({ x: p.x, y: 100 * p.y })),
          "给药后时间 (h)",
          "占初始值的比例 (%)",
        ),
        drugChart(
          "游离药物（相对初始浓度）",
          course.map((p) => ({
            x: p.x,
            y: 100 * 2 ** (-p.x / values.plasmaHalfLife),
          })),
          "给药后时间 (h)",
          "占初始值的比例 (%)",
        ),
      ],
    };
  },
};
medicinalChemistryModels["drug-action-covalent"] = {
  inputs: [
    range("inhibitor", "抑制剂 [I]", 0, 2000, 10, 100, "nM"),
    range("ki", "KI", 10, 500, 10, 100, "nM"),
    range("kinact", "kinact", 0.005, 0.2, 0.005, 0.05, "min⁻¹"),
    range("koff", "可逆对照 koff", 0.01, 1, 0.01, 0.1, "min⁻¹"),
  ],
  run({ inhibitor, ki, kinact, koff }) {
    const rate = da.kobs(inhibitor, ki, kinact),
      half = da.halfLife(rate);
    return {
      summary: `kobs = ${rate.toFixed(4)} min⁻¹；失活半衰期 = ${Number.isFinite(half) ? half.toFixed(2) + " min" : "∞（不失活）"}；kinact/KI = ${(((kinact / ki) * 1e9) / 60).toFixed(0)} M⁻¹·s⁻¹。无再结合时，平均停留时间 τ = ${da.residenceTime(koff).toFixed(2)} min，解离半衰期 = ${da.halfLife(koff).toFixed(2)} min。此输入只影响解离读数，不改变上方恒浓度平衡曲线。`,
      charts: [
        drugChart(
          "未共价失活比例",
          Array.from({ length: 61 }, (_, t) => ({
            x: t * 2,
            y: 100 * da.remainingActivity(t * 2, rate),
          })),
          "时间 (min)",
          "剩余比例 (%)",
        ),
        drugChart(
          "可逆平衡剩余活性",
          Array.from({ length: 61 }, (_, t) => ({
            x: t * 2,
            y: 100 * (1 - da.occupancy(inhibitor, ki)),
          })),
          "时间 (min)",
          "剩余比例 (%)",
        ),
      ],
    };
  },
};

export const leadMath = (() => {
  /** Teaching models. Monoprotic solute; ionized species do not partition into octanol. */
  function logD(logP, pKa, pH, kind) {
    const x = kind === "acid" ? pH - pKa : pKa - pH;
    return logP - (Math.max(0, x) + Math.log10(1 + 10 ** -Math.abs(x)));
  }

  /** Linear one-compartment oral model: mg, L, h, mg/L. No lag time. */

  function elimination(p) {
    return p.cl / p.vd;
  }
  function halfLife(p) {
    return Math.LN2 / elimination(p);
  }
  function auc(p) {
    return (p.f * p.dose) / p.cl;
  }
  function concentration(t, p) {
    if (t <= 0) return 0;
    const ke = elimination(p);
    const delta = p.ka - ke;
    if (Math.abs(delta) < 1e-8)
      return ((p.f * p.dose) / p.vd) * p.ka * t * Math.exp(-ke * t);
    return (
      (((p.f * p.dose * p.ka) / p.vd) *
        (Math.exp(-ke * t) - Math.exp(-p.ka * t))) /
      delta
    );
  }
  function peakTime(p) {
    const ke = elimination(p);
    return Math.abs(p.ka - ke) < 1e-8
      ? 1 / ke
      : Math.log(p.ka / ke) / (p.ka - ke);
  }
  function repeatedConcentration(t, p) {
    if (t < 0) return 0;
    let c = 0;
    for (let n = 0; n <= Math.floor(t / p.tau); n++)
      c += concentration(t - n * p.tau, p);
    return c;
  }
  /** Accumulation of the elimination exponential; not the oral peak ratio. */
  function accumulation(p) {
    return 1 / -Math.expm1(-elimination(p) * p.tau);
  }
  function steadyConcentration(t, p) {
    const ke = elimination(p);
    const phase = ((t % p.tau) + p.tau) % p.tau;
    if (Math.abs(p.ka - ke) < 1e-8) {
      const q = Math.exp(-ke * p.tau);
      return (
        ((p.f * p.dose * ke) / p.vd) *
        Math.exp(-ke * phase) *
        (phase / (1 - q) + (p.tau * q) / (1 - q) ** 2)
      );
    }
    return (
      ((p.f * p.dose * p.ka) / (p.vd * (p.ka - ke))) *
      (Math.exp(-ke * phase) / -Math.expm1(-ke * p.tau) -
        Math.exp(-p.ka * phase) / -Math.expm1(-p.ka * p.tau))
    );
  }
  function steadyPeakTime(p) {
    const ke = elimination(p);
    if (Math.abs(p.ka - ke) < 1e-8)
      return 1 / ke - p.tau / Math.expm1(ke * p.tau);
    return (
      Math.log(
        (p.ka * -Math.expm1(-ke * p.tau)) / (ke * -Math.expm1(-p.ka * p.tau)),
      ) /
      (p.ka - ke)
    );
  }

  /** A value as the source prints it, with the assay system when the source names one. */

  /** What one source prints for one compound of the sildenafil path. */

  const nanomolar = (m) => `${m.raw} nM${m.system ? `（${m.system}）` : ""}`;
  function describeReading(reading) {
    const parts = [`PDE5 IC₅₀ ${reading.pde5.map(nanomolar).join("、")}`];
    parts.push(`PDE3 ${reading.pde3}`);
    if (reading.pde6) parts.push(`PDE6 ${nanomolar(reading.pde6)}`);
    if (reading.logD) parts.push(`logD ${reading.logD}`);
    return `${reading.where}：${parts.join("；")}`;
  }

  return {
    logD,
    elimination,
    halfLife,
    auc,
    concentration,
    peakTime,
    repeatedConcentration,
    accumulation,
    steadyConcentration,
    steadyPeakTime,
    describeReading,
  };
})();
medicinalChemistryModels["lead-pk"] = {
  inputs: [
    range("dose", "剂量 D（mg）", 10, 500, 10, 100),
    range("f", "生物利用度 F（比例）", 0.05, 1, 0.05, 0.5),
    range("ka", "吸收速率 ka（h⁻¹）", 0.05, 3, 0.05, 1),
    range("cl", "清除率 Cl（L/h）", 1, 20, 1, 5),
    range("vd", "分布容积 Vd（L）", 10, 200, 10, 50),
    range("tau", "给药间隔 τ（h）", 4, 24, 1, 12),
  ],
  run(p) {
    const m = leadMath,
      peak = m.steadyConcentration(m.steadyPeakTime(p), p),
      trough = m.steadyConcentration(0, p);
    return {
      summary: `稳态峰值 ${peak.toFixed(3)} mg/L；稳态谷值 ${trough.toFixed(3)} mg/L。t½ = ${m.halfLife(p).toFixed(2)} h；单剂 AUC = ${m.auc(p).toFixed(2)} mg·h/L；稳态平均浓度 = ${(m.auc(p) / p.tau).toFixed(3)} mg/L。消除项蓄积因子 = ${m.accumulation(p).toFixed(3)}；单剂 2 h 浓度 = ${m.concentration(2, p).toFixed(3)} mg/L。`,
      charts: [
        {
          points: Array.from({ length: 481 }, (_, i) => ({
            x: i / 4,
            y: m.repeatedConcentration(i / 4, p),
          })),
          xLabel: "给药后时间（h）",
          yLabel: "血浆总浓度（mg/L）",
        },
      ],
    };
  },
};
medicinalChemistryModels["lead-properties"] = {
  inputs: [
    {
      id: "kind",
      label: "电离类型",
      kind: "select",
      options: [
        { value: "acid", label: "单质子弱酸" },
        { value: "base", label: "单质子弱碱" },
      ],
      default: "base",
    },
    range("pKa", "pKa", 2, 12, 0.1, 7),
    range("logP", "logP", -1, 6, 0.1, 3),
  ],
  run({ kind, pKa, logP }) {
    const points = Array.from({ length: 141 }, (_, i) => ({
      x: i / 10,
      y: leadMath.logD(logP, pKa, i / 10, kind),
    }));
    return {
      summary: `pH = 7.4 时 logD = ${leadMath.logD(logP, pKa, 7.4, kind).toFixed(2)}；pH = pKa 时 logD = ${(logP - Math.log10(2)).toFixed(2)}。`,
      charts: [
        {
          points,
          xLabel: "水相 pH",
          yLabel: "logD（无量纲）",
          xDomain: [0, 14],
          yDomain: [Math.min(...points.map((p) => p.y)), logP],
        },
      ],
    };
  },
};

export const fbddMath = (() => {
  /** Printed numbers and the arithmetic built on them; every input is a number from a cited source. */

  /** Gas constant in kcal·mol⁻¹·K⁻¹. */
  const R = 0.001987204;
  /** Temperature of the linking arithmetic, K. */
  const TEMPERATURE = 298.15;

  /** Components of a split-and-pool library: the product of the synthon counts of its cycles. */
  function libraryComponents(synthonsPerCycle) {
    if (
      !synthonsPerCycle.length ||
      synthonsPerCycle.some((n) => !Number.isInteger(n) || n < 1)
    )
      throw new Error("每一轮的砌块数必须是正整数");
    return synthonsPerCycle.reduce((product, n) => product * n, 1);
  }

  /** Fold enrichment of a member present once in `library` and seen `copies` times in `reads`. */
  function enrichment(copies, reads, library) {
    if (copies <= 0 || reads <= 0 || library <= 0)
      throw new Error("拷贝数、读数和库大小必须为正");
    return copies / reads / (1 / library);
  }

  /** Geometric mean of the per-round enrichment that compounds to `total` over `rounds`. */
  function perRoundEnrichment(total, rounds) {
    if (total <= 0 || !Number.isInteger(rounds) || rounds < 1)
      throw new Error("总富集必须为正，轮数必须是正整数");
    return total ** (1 / rounds);
  }

  /**
   * Share of the reads a single spiked-in member occupies after `round` rounds,
   * if every round multiplied its share by the same factor. Only the share after
   * the last round of `positiveControl` is measured; earlier rounds follow from
   * the constant-factor assumption.
   */
  function shareAfterRounds(round, control) {
    if (!Number.isInteger(round) || round < 1 || round > control.rounds)
      throw new Error(`轮数必须在 1 到 ${control.rounds} 之间`);
    const factor = perRoundEnrichment(
      enrichment(control.copies, control.reads, control.library),
      control.rounds,
    );
    return Math.min(1, factor ** round / control.library);
  }

  /** P(X ≥ k) for X ~ Binomial(n, p), summed over the k terms below the threshold. */
  function probAtLeast(k, n, p) {
    if (!Number.isInteger(k) || k < 0 || !Number.isInteger(n) || n < 0)
      throw new Error("k 与 n 必须是非负整数");
    if (!(p >= 0 && p <= 1)) throw new Error("p 必须在 0 到 1 之间");
    if (k === 0) return 1;
    if (n < k || p === 0) return 0;
    if (p === 1) return 1;
    let below = 0;
    let logChoose = 0;
    for (let i = 0; i < k; i++) {
      below += Math.exp(logChoose + i * Math.log(p) + (n - i) * Math.log1p(-p));
      logChoose += Math.log((n - i) / (i + 1));
    }
    return Math.min(1, Math.max(0, 1 - below));
  }

  /** Smallest number of reads for which the member is seen at least `k` times with probability `confidence`. */
  function readsNeeded(k, p, confidence) {
    if (!(confidence > 0 && confidence < 1))
      throw new Error("置信度必须在 0 与 1 之间");
    if (!(p > 0 && p <= 1)) throw new Error("p 必须在 0 与 1 之间");
    let low = k;
    let high = Math.max(k, 1);
    while (probAtLeast(k, high, p) < confidence) high *= 2;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (probAtLeast(k, mid, p) >= confidence) high = mid;
      else low = mid + 1;
    }
    return low;
  }

  /** Share of reads kept by a copy-number filter: the printed counts after filtering over before. */
  function keptShare(keptReads, reads) {
    if (keptReads < 0 || reads <= 0 || keptReads > reads)
      throw new Error("保留读数必须在 0 与总读数之间");
    return keptReads / reads;
  }

  /** Binding free energy of a dissociation constant in molar, kcal·mol⁻¹ (standard state 1 M). */
  function bindingEnergy(kd, temperature = TEMPERATURE) {
    if (!(kd > 0)) throw new Error("Kd 必须为正");
    return R * temperature * Math.log(kd);
  }

  /** Kd of two fragments joined with no cost for the link: the free energies add. Molar in, molar out. */
  function idealLinkedKd(kd1, kd2) {
    if (!(kd1 > 0 && kd2 > 0)) throw new Error("Kd 必须为正");
    return kd1 * kd2;
  }

  /** What joining the fragments cost: observed over ideal Kd, and the same in kcal·mol⁻¹. */
  function linkingCost(kd1, kd2, observed, temperature = TEMPERATURE) {
    const ideal = idealLinkedKd(kd1, kd2);
    return {
      ideal,
      ratio: observed / ideal,
      energy:
        bindingEnergy(observed, temperature) -
        bindingEnergy(kd1, temperature) -
        bindingEnergy(kd2, temperature),
    };
  }

  /** Ligand efficiency after Hopkins 2004 as the site's efficiency chapter uses it: 1.37 · pK / heavy atoms. */
  function ligandEfficiency(k, heavyAtoms) {
    if (!(k > 0) || !Number.isInteger(heavyAtoms) || heavyAtoms < 1)
      throw new Error("K 必须为正，重原子数必须是正整数");
    return (1.37 * -Math.log10(k)) / heavyAtoms;
  }

  /** Region a reader marked against the atoms a question checks. */
  function regionMatch(selected, target) {
    if (!selected.length) return "none";
    const inside = selected.filter((atom) => target.includes(atom)).length;
    if (inside === selected.length) return "all";
    return inside ? "some" : "none";
  }

  /** Positions a reader marked on the 7-azaindole fragment, against the two the drug modifies. */
  function positionsFound(selected, target) {
    return new Set(selected.filter((atom) => target.includes(atom))).size;
  }

  /** A concentration in molar, as a number and the unit that keeps it between 1 and 1000. */
  function formatMolar(molar) {
    if (!(molar > 0)) throw new Error("浓度必须为正");
    const units = [
      ["mM", 1e-3],
      ["µM", 1e-6],
      ["nM", 1e-9],
      ["pM", 1e-12],
    ];
    const [unit, scale] =
      units.find(([, scale]) => molar >= scale * 0.9995) ?? units[3];
    return `${Number((molar / scale).toPrecision(3))} ${unit}`;
  }

  return {
    TEMPERATURE,
    libraryComponents,
    enrichment,
    perRoundEnrichment,
    shareAfterRounds,
    probAtLeast,
    readsNeeded,
    keptShare,
    bindingEnergy,
    idealLinkedKd,
    linkingCost,
    ligandEfficiency,
    regionMatch,
    positionsFound,
    formatMolar,
  };
})();
const fbddUnit = (id, label, value) => ({
  id,
  label,
  kind: "select",
  options: ["mM", "µM", "nM"].map((value) => ({ value, label: value })),
  default: value,
});
medicinalChemistryModels["fbdd-linking"] = {
  inputs: [
    numeric("kd1", "片段 1 的 Kd", Number.MIN_VALUE, Number.MAX_VALUE, 2),
    fbddUnit("kd1Unit", "片段 1 的单位", "µM"),
    numeric("kd2", "片段 2 的 Kd", Number.MIN_VALUE, Number.MAX_VALUE, 100),
    fbddUnit("kd2Unit", "片段 2 的单位", "µM"),
    numeric(
      "observed",
      "连接分子的实测 Kd",
      Number.MIN_VALUE,
      Number.MAX_VALUE,
      19,
    ),
    fbddUnit("observedUnit", "实测值的单位", "nM"),
  ],
  run({ kd1, kd1Unit, kd2, kd2Unit, observed, observedUnit }) {
    const units = { mM: 1e-3, µM: 1e-6, nM: 1e-9 };
    const r = fbddMath.linkingCost(
      kd1 * units[kd1Unit],
      kd2 * units[kd2Unit],
      observed * units[observedUnit],
    );
    return {
      summary: `理想 Kd ${fbddMath.formatMolar(r.ideal)}；实测是理想值的 ${Number(r.ratio.toPrecision(3))} 倍；连接代价 ${r.energy.toFixed(2)} kcal·mol⁻¹。`,
    };
  },
};
medicinalChemistryModels["fbdd-depth"] = {
  inputs: [
    range("exponent", "读出序列数（对数刻度）", 2, 6, 0.05, 2),
    {
      id: "rounds",
      label: "选择轮数",
      kind: "select",
      options: [1, 2, 3].map((value) => ({
        value,
        label: value === 3 ? "3 轮（实测）" : `${value} 轮`,
      })),
      default: 3,
    },
    {
      id: "threshold",
      label: "过滤阈值（保留出现至少 k 次的序列）",
      kind: "select",
      options: [
        { value: 1, label: "k = 1（不过滤）" },
        { value: 4, label: "k = 4（Aurora A 的过滤）" },
        { value: 10, label: "k = 10（p38 的过滤）" },
      ],
      default: 4,
    },
  ],
  run({ exponent, rounds, threshold }, data) {
    const m = fbddMath,
      reads = Math.round(10 ** exponent),
      share = m.shareAfterRounds(rounds, data),
      expected = reads * share,
      chance = m.probAtLeast(threshold, reads, share),
      needed = m.readsNeeded(threshold, share, 0.95);
    const percent = (p) =>
      p >= 0.9995 ? "接近 100%" : `${(p * 100).toFixed(p < 0.01 ? 3 : 1)}%`;
    return {
      summary: `读出序列数：${reads.toLocaleString("zh-CN")}`,
      readouts: [
        {
          label: "阳性对照占读数的比例",
          value: (share * 100).toPrecision(3) + "%",
        },
        { label: "期望拷贝数", value: expected.toPrecision(3) },
        { label: `出现至少 ${threshold} 次的概率`, value: percent(chance) },
        {
          label: "95% 把握所需的读数",
          value: needed.toLocaleString("zh-CN") + " 条",
        },
      ],
      charts: [
        {
          points: Array.from({ length: 41 }, (_, i) => {
            const x = 2 + i * 0.1;
            return {
              x: Number(x.toFixed(1)),
              y: m.probAtLeast(threshold, Math.round(10 ** x), share),
            };
          }),
          xLabel: "log₁₀（读出序列数）",
          yLabel: "出现至少 k 次的概率",
        },
      ],
    };
  },
};
