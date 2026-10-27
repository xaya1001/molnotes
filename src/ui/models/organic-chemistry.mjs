/** Ideal standard-state estimates; energies in kJ/mol and T in kelvin. */
const R = 0.008314462618;
function finite(value) {
  if (!Number.isFinite(value)) throw new Error("请输入有限数值");
}
export function acidEquilibrium(pKaHA, pKaHB) {
  finite(pKaHA);
  finite(pKaHB);
  if (Math.abs(pKaHA) > 60 || Math.abs(pKaHB) > 60)
    throw new Error("pKa 请在 −60 至 60 之间");
  const logK = pKaHB - pKaHA;
  return { logK, K: 10 ** logK };
}
export function pathwayFractions(
  temperature,
  barrierP,
  barrierQ,
  energyQminusP,
) {
  for (const v of [temperature, barrierP, barrierQ, energyQminusP]) finite(v);
  if (temperature < 200 || temperature > 500)
    throw new Error("温度请在 200–500 K 之间");
  if (
    barrierP < 0 ||
    barrierQ < 0 ||
    barrierP > 200 ||
    barrierQ > 200 ||
    Math.abs(energyQminusP) > 50
  )
    throw new Error("能量超出教学模型范围");
  // Equal prefactors, irreversible initial capture versus equilibrated P/Q.
  const kineticP =
    1 / (1 + Math.exp((barrierP - barrierQ) / (R * temperature)));
  const equilibriumP = 1 / (1 + Math.exp(-energyQminusP / (R * temperature)));
  return { kineticP, equilibriumP };
}
/** Share of the product side at equilibrium for K = [products]/[reactants]. */
export function productShare(K) {
  finite(K);
  if (K < 0) throw new Error("K 不能为负");
  return K / (1 + K);
}
/** K = exp(−ΔG/RT) for ΔG in kJ/mol and T in kelvin, with the product share it gives. */
export function equilibriumFromDeltaG(deltaG, temperature) {
  finite(deltaG);
  finite(temperature);
  if (temperature < 200 || temperature > 500)
    throw new Error("温度请在 200–500 K 之间");
  if (Math.abs(deltaG) > 60) throw new Error("ΔG 请在 −60 至 60 kJ/mol 之间");
  const K = Math.exp(-deltaG / (R * temperature));
  return { K, productShare: productShare(K) };
}

const numberInput = (id, label, min, max, value, step = 0.1) => ({
  id,
  label,
  kind: "number",
  min,
  max,
  default: value,
  step,
});

/** @type {Record<string, import("./catalog.ts").LabModel & { calculate?: unknown }>} */
export const organicChemistryModels = {
  "carbonyl-acidity": {
    inputs: [
      numberInput("ha", "pKa(HA)", -60, 60, 25),
      numberInput("hb", "pKa(HB)", -60, 60, 33),
    ],
    calculate: acidEquilibrium,
    run({ ha, hb }) {
      const v = acidEquilibrium(ha, hb);
      return {
        summary: `log₁₀K = ${v.logK.toFixed(1)}；K = ${v.K.toExponential(2)}。${v.logK > 0 ? "右侧有利" : v.logK < 0 ? "左侧有利" : "标准态两侧相当"}。`,
      };
    },
  },
  "carbonyl-equilibrium": {
    inputs: [numberInput("deltaG", "ΔG（kJ/mol）", -60, 60, -8.8)],
    calculate: equilibriumFromDeltaG,
    productShare,
    run({ deltaG }) {
      const v = equilibriumFromDeltaG(deltaG, 298);
      return {
        summary: `K = ${v.K.toPrecision(3)}；产物侧占 ${(v.productShare * 100).toFixed(2)}%。`,
      };
    },
  },
  "carbonyl-pathways": {
    inputs: [
      numberInput("temperature", "温度（K）", 200, 500, 298, 1),
      numberInput("barrierP", "P 生成能垒（kJ/mol）", 0, 200, 55, 1),
      numberInput("barrierQ", "Q 生成能垒（kJ/mol）", 0, 200, 60, 1),
      numberInput("energy", "G(Q)−G(P)（kJ/mol）", -50, 50, -8.8),
    ],
    calculate: pathwayFractions,
    run({ temperature, barrierP, barrierQ, energy }) {
      const v = pathwayFractions(temperature, barrierP, barrierQ, energy);
      return {
        summary: `初始 P ${(v.kineticP * 100).toFixed(1)}% / Q ${((1 - v.kineticP) * 100).toFixed(1)}%；平衡 P ${(v.equilibriumP * 100).toFixed(1)}% / Q ${((1 - v.equilibriumP) * 100).toFixed(1)}%。`,
      };
    },
  },
};

/**
 * Radical hydrogen abstraction and ring closure, from printed numbers only.
 * Shares are percentages of the monohalide mixture; a factor is the reactivity of
 * one hydrogen of a type relative to one primary hydrogen.
 */

export const hydrogenLabel = {
  primary: "一级氢",
  secondary: "二级氢",
  tertiary: "三级氢",
};
const order = ["primary", "secondary", "tertiary"];

export function measuredFor(alkane, halogen, measurements) {
  return measurements.find((m) => m.alkane === alkane && m.halogen === halogen);
}

function positive(value, what) {
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`${what}必须是正数`);
}

/** Reactivity per hydrogen of A relative to B: (share A / n A) / (share B / n B). */
export function factor(shareA, nA, shareB, nB) {
  for (const [value, what] of [
    [shareA, "产物比例"],
    [nA, "氢的个数"],
    [shareB, "产物比例"],
    [nB, "氢的个数"],
  ])
    positive(value, what);
  return shareA / nA / (shareB / nB);
}

/** Product shares (%) when every hydrogen of a type reacts at the given factor. */
export function distribution(counts, factors) {
  const weights = order.flatMap((type) => {
    const n = counts[type];
    if (n === undefined) return [];
    const f = type === "primary" ? 1 : factors[type];
    if (f === undefined) throw new Error(`缺少${hydrogenLabel[type]}的因子`);
    positive(f, "逐氢活性");
    return [[type, n * f]];
  });
  const total = weights.reduce((sum, [, w]) => sum + w, 0);
  return Object.fromEntries(
    weights.map(([type, w]) => [type, (100 * w) / total]),
  );
}

const trim = (x) => (Number.isInteger(x) ? String(x) : x.toFixed(2));
/** The per-hydrogen factor each printed ratio gives, with a lower bound where the page prints one. */
export function derive(m, counts) {
  const reference = m.shares.primary;
  return order.flatMap((type) => {
    if (type === "primary") return [];
    const share = m.shares[type];
    if (!share) return [];
    const nA = counts[type];
    const nB = counts.primary;
    const exact = share.op === "=" && reference.op === "=";
    // A factor is bounded below when the tertiary share is a floor and the primary a ceiling.
    if (!exact && !(share.op === ">" && reference.op === "<"))
      throw new Error("界限方向不能给出因子");
    const value = factor(share.value, nA, reference.value, nB);
    const working = `(${share.value}/${nA}) ÷ (${reference.value}/${nB}) = ${trim(value)}`;
    return [{ type, op: exact ? "=" : ">", value, working }];
  });
}

/** Explicit source descriptors distinguish derived exact factors from printed values. */
export function offered(halogen, data) {
  const selected = data.halogens.find((h) => h.id === halogen);
  return Object.fromEntries(
    ["secondary", "tertiary"].map((type) => {
      const descriptor = selected.offered[type];
      if (descriptor.kind === "printed") return [type, descriptor.value];
      const measurement = measuredFor(
        descriptor.alkane,
        halogen,
        data.measured,
      );
      const counts = data.alkanes.find(
        (a) => a.id === descriptor.alkane,
      ).counts;
      const result = derive(measurement, counts).find((d) => d.type === type);
      if (!result || result.op !== "=")
        throw new Error("提供因子须有对应的确切实测比例");
      return [type, result.value];
    }),
  );
}

/** The mode that wins in the printed "found" column. */
export function winner(row) {
  const { op, value } = row.foundRatio;
  if (op === "<") return "endo";
  if (op === ">") return "exo";
  return value > 1 ? "exo" : "endo";
}
export function closureRatio(c) {
  positive(c.main, "产物比例");
  positive(c.minor, "产物比例");
  return c.main / c.minor;
}

/**
 * ee and the free-energy gap between two competing transition states, ΔΔG‡ = RT ln(er).
 * Assumes exactly two competing pathways, a ΔΔG‡ that does not change with temperature,
 * no unselective background reaction and no racemisation of the product.
 */
export const gasConstant = 8.314462618e-3; // kJ mol⁻¹ K⁻¹
export const kjPerKcal = 4.184;
export const assumedKelvin = 298.15;

export function kelvin(celsius) {
  if (!Number.isFinite(celsius) || celsius < -150 || celsius > 150)
    throw new Error("温度请在 −150 到 150 °C 之间");
  return celsius + 273.15;
}
/** Enantiomer fractions (%) of a sample with the given ee (%). */
export function eeToEr(ee) {
  if (!Number.isFinite(ee) || ee < 0 || ee >= 100)
    throw new Error("ee 请在 0 到 100 之间，不含 100");
  const major = (100 + ee) / 2;
  const minor = (100 - ee) / 2;
  return { major, minor, ratio: major / minor };
}
export function erToEe(major, minor) {
  positive(major, "对映体比例");
  positive(minor, "对映体比例");
  return (100 * (major - minor)) / (major + minor);
}
/** ΔΔG‡ in kJ/mol that gives `ee` (%) at `temperature` (K). */
export function ddG(ee, temperature) {
  positive(temperature, "温度");
  return gasConstant * temperature * Math.log(eeToEr(ee).ratio);
}
/** The ee (%) that a ΔΔG‡ (kJ/mol) gives at `temperature` (K). */
export function eeFromDdG(delta, temperature) {
  positive(temperature, "温度");
  if (!Number.isFinite(delta) || delta < 0) throw new Error("ΔΔG‡ 不能为负");
  const ratio = Math.exp(delta / (gasConstant * temperature));
  return (100 * (ratio - 1)) / (ratio + 1);
}
export const toKcal = (kj) => kj / kjPerKcal;

export function pointGap(point) {
  const temperature =
    point.celsius === undefined ? assumedKelvin : kelvin(point.celsius);
  return {
    temperature,
    assumed: point.celsius === undefined,
    kj: ddG(point.ee, temperature),
  };
}

function validateRadicalData(data) {
  const text = (v) => typeof v === "string" && v.trim().length > 0;
  const require = (condition, field) => {
    if (!condition) throw new Error(`自由基数据 ${field} 无效`);
  };
  require(data &&
    text(data.sourceLabel) &&
    Array.isArray(data.alkanes) &&
    data.alkanes.length > 0 &&
    Array.isArray(data.halogens) &&
    data.halogens.length > 0 &&
    Array.isArray(data.measured), "dataset");
  const alkanes = new Map(),
    halogens = new Set();
  for (const a of data.alkanes) {
    require(a &&
      text(a.id) &&
      !alkanes.has(a.id) &&
      text(a.name) &&
      a.counts &&
      a.products, "alkane");
    const keys = Object.keys(a.counts);
    require(keys.includes("primary") &&
      keys.every(
        (k) =>
          order.includes(k) &&
          Number.isInteger(a.counts[k]) &&
          a.counts[k] > 0 &&
          text(a.products[k]),
      ) &&
      Object.keys(a.products).every((k) =>
        keys.includes(k),
      ), "counts/products");
    alkanes.set(a.id, a);
  }
  for (const h of data.halogens) {
    require(h &&
      text(h.id) &&
      !halogens.has(h.id) &&
      text(h.label) &&
      text(h.source) &&
      h.offered, "halogen");
    halogens.add(h.id);
  }
  const pairs = new Set();
  for (const m of data.measured) {
    const a = alkanes.get(m?.alkane),
      pair = JSON.stringify([m?.alkane, m?.halogen]);
    require(a &&
      halogens.has(m.halogen) &&
      !pairs.has(pair) &&
      text(m.page) &&
      text(m.condition) &&
      text(m.note) &&
      m.shares, "measurement");
    pairs.add(pair);
    const keys = Object.keys(m.shares);
    require(keys.length === Object.keys(a.counts).length &&
      keys.every((k) => k in a.counts), "share keys");
    for (const share of Object.values(m.shares))
      require(share &&
        ["=", "<", ">"].includes(share.op) &&
        Number.isFinite(share.value) &&
        share.value > 0 &&
        share.value <= 100, "share");
    const shares = Object.values(m.shares);
    if (shares.every((s) => s.op === "="))
      require(Math.abs(shares.reduce((sum, s) => sum + s.value, 0) - 100) <
        1e-9, "share total");
    else {
      const lower = shares.reduce(
        (sum, s) => sum + (s.op === "<" ? 0 : s.value),
        0,
      );
      const upper = shares.reduce(
        (sum, s) => sum + (s.op === ">" ? 100 : s.value),
        0,
      );
      require(lower < 100 && upper > 100, "share bounds");
    }
    derive(m, a.counts);
  }
  for (const h of data.halogens) {
    for (const type of ["secondary", "tertiary"]) {
      const descriptor = h.offered[type];
      require(descriptor &&
        ["printed", "measured"].includes(descriptor.kind), "factor kind");
      if (descriptor.kind === "printed")
        require(Number.isFinite(descriptor.value) &&
          descriptor.value > 0, "printed factor");
      else {
        const m = measuredFor(descriptor.alkane, h.id, data.measured);
        require(m && alkanes.has(descriptor.alkane), "factor reference");
        const result = derive(m, alkanes.get(descriptor.alkane).counts).find(
          (d) => d.type === type,
        );
        require(result && result.op === "=", "exact factor");
      }
    }
  }
  require(data.defaults &&
    alkanes.has(data.defaults.estimateAlkane) &&
    alkanes.has(data.defaults.offeredAlkane) &&
    halogens.has(data.defaults.halogen), "defaults");
}

Object.assign(organicChemistryModels, {
  "enantioselectivity-energy": {
    inputs: [
      numberInput("celsius", "温度（°C）", -150, 150, -20),
      numberInput("targetEe", "目标 ee（%）", 0, 99.99, 94),
      numberInput("gap", "ΔΔG‡（kJ/mol）", 0, 100, 5),
    ],
    run({ celsius, targetEe, gap }) {
      const t = kelvin(celsius),
        er = eeToEr(targetEe),
        value = ddG(targetEe, t);
      return {
        summary: `ee ${targetEe}% 即 ${er.major.toFixed(2)}:${er.minor.toFixed(2)}，需要 ΔΔG‡ = ${value.toFixed(2)} kJ/mol（${toKcal(value).toFixed(2)} kcal/mol）。`,
        readouts: [
          {
            label: `ΔΔG‡ = ${gap} kJ/mol，在 ${celsius} °C 给出 ee`,
            value: `${eeFromDdG(gap, t).toFixed(2)}%。`,
          },
        ],
        charts: [
          {
            title: "25 °C（298.15 K，假定）",
            xLabel: "ΔΔG‡（kJ/mol）",
            yLabel: "ee（%）",
            points: Array.from({ length: 81 }, (_, i) => ({
              x: i * 0.25,
              y: eeFromDdG(i * 0.25, assumedKelvin),
            })),
          },
          {
            title: "−20 °C（253.15 K）",
            xLabel: "ΔΔG‡（kJ/mol）",
            yLabel: "ee（%）",
            points: Array.from({ length: 81 }, (_, i) => ({
              x: i * 0.25,
              y: eeFromDdG(i * 0.25, kelvin(-20)),
            })),
          },
        ],
      };
    },
  },
  "enantioselectivity-estimate": {
    inputs: [numberInput("guess", "你的估计（kJ/mol）", 0, 100, 5)],
    run({ guess }) {
      return {
        summary: `你估计的 ${guess} kJ/mol，在 −20 °C 给出 ${eeFromDdG(guess, kelvin(-20)).toFixed(1)}% ee。`,
      };
    },
  },
  "radical-selectivity": {
    validateData: validateRadicalData,
    inputs: (data) => [
      {
        id: "alkaneId",
        label: "烷烃",
        kind: "select",
        options: data.alkanes.map((a) => ({ value: a.id, label: a.name })),
        default: data.defaults.estimateAlkane,
      },
      {
        id: "halogen",
        label: "自由基",
        kind: "select",
        options: data.halogens.map((h) => ({ value: h.id, label: h.label })),
        default: data.defaults.halogen,
      },
      numberInput("secondary", "二级氢的逐氢活性（一级氢 = 1）", 1, 10000, 1),
      numberInput("tertiary", "三级氢的逐氢活性（一级氢 = 1）", 1, 10000, 1),
    ],
    run({ alkaneId, halogen, secondary, tertiary }, data) {
      const a = data.alkanes.find((a) => a.id === alkaneId);
      const h = data.halogens.find((h) => h.id === halogen);
      if (!a || !h) throw new Error("请选择烷烃与自由基");
      const estimate = distribution(a.counts, { secondary, tertiary }),
        measurement = measuredFor(alkaneId, halogen, data.measured);
      const readouts = Object.entries(estimate).map(([type, value]) => ({
        label: `${hydrogenLabel[type]}（${a.counts[type]} 个）→ ${a.products[type]}`,
        value: `${value.toFixed(1)}%`,
      }));
      let revealed;
      if (measurement) {
        const factors = derive(measurement, a.counts);
        let summary = `${data.sourceLabel} ${measurement.page}：${a.name}与 ${h.label}（${measurement.condition}）。`;
        summary += measurement.note;
        revealed = {
          summary,
          readouts: Object.entries(measurement.shares).map(([type, share]) => ({
            label: hydrogenLabel[type],
            value: `${data.sourceLabel}的产物比例 ${share.op === "=" ? "" : share.op}${share.value}%；由此算出的逐氢活性 ${
              type === "primary"
                ? "1（参照）"
                : factors
                    .filter((d) => d.type === type)
                    .map((d) => (d.op === ">" ? "> " : "") + d.working)
                    .join("")
            }`,
          })),
        };
      } else
        revealed = {
          summary: `${data.sourceLabel}没有给出${a.name}与 ${h.label}的实测。`,
        };
      return { summary: "你的估计", readouts, revealed };
    },
  },
  "radical-distribution": {
    validateData: validateRadicalData,
    inputs: (data) => [
      {
        id: "alkaneId",
        label: "烷烃",
        kind: "select",
        options: data.alkanes.map((a) => ({ value: a.id, label: a.name })),
        default: data.defaults.offeredAlkane,
      },
      {
        id: "halogen",
        label: "自由基",
        kind: "select",
        options: data.halogens.map((h) => ({ value: h.id, label: h.label })),
        default: data.defaults.halogen,
      },
    ],
    run({ alkaneId, halogen }, data) {
      const a = data.alkanes.find((a) => a.id === alkaneId);
      const h = data.halogens.find((h) => h.id === halogen);
      if (!a || !h) throw new Error("请选择烷烃与自由基");
      const f = offered(halogen, data),
        shares = distribution(a.counts, f);
      return {
        revealed: {
          summary: `由逐氢因子算出，非实测。因子：二级氢 ${trim(f.secondary)}，三级氢 ${trim(f.tertiary)}（${h.source}）。`,
          readouts: Object.entries(shares).map(([type, value]) => ({
            label: `${hydrogenLabel[type]}产物`,
            value: `${value.toFixed(1)}%`,
          })),
        },
      };
    },
  },
});

/** Two-state equilibrium only. ΔG = G(axial) − G(equatorial), kJ/mol.
 * Constant ΔG; ignores solvent, multiple conformers and temperature dependence. */
export function chairEquilibrium(deltaG, kelvin) {
  if (
    !Number.isFinite(deltaG) ||
    deltaG < -25 ||
    deltaG > 25 ||
    !Number.isFinite(kelvin) ||
    kelvin < 250 ||
    kelvin > 350
  )
    throw new Error("请输入−25至25 kJ/mol及250至350 K。");
  const ratio = Math.exp((deltaG * 1000) / (8.314462618 * kelvin));
  return { ratio, equatorial: ratio / (1 + ratio), axial: 1 / (1 + ratio) };
}

organicChemistryModels["saturated-chair"] = {
  validateData(data) {
    const text = (v) => typeof v === "string" && v.trim().length > 0;
    if (
      !data ||
      !Array.isArray(data.rows) ||
      data.rows.length === 0 ||
      !text(data.referenceLabel)
    )
      throw new Error("缺少构象参考数据");
    if (
      !Number.isFinite(data.referenceTemperature) ||
      data.referenceTemperature < 250 ||
      data.referenceTemperature > 350 ||
      !Number.isFinite(data.defaultDeltaG) ||
      data.defaultDeltaG < -25 ||
      data.defaultDeltaG > 25
    )
      throw new Error("构象参考温度或默认自由能差超出范围");
    const energies = new Set();
    for (const row of data.rows) {
      if (
        !row ||
        !text(row.substituent) ||
        !Number.isFinite(row.deltaG) ||
        energies.has(row.deltaG) ||
        !Number.isFinite(row.k) ||
        row.k <= 0 ||
        !Number.isFinite(row.percent) ||
        row.percent < 0 ||
        row.percent > 100 ||
        (row.lowerBound !== undefined && typeof row.lowerBound !== "boolean")
      )
        throw new Error("构象参考行无效或自由能差重复");
      energies.add(row.deltaG);
    }
    if (!energies.has(data.defaultDeltaG))
      throw new Error("默认自由能差须来自参考行");
  },
  inputs: (data) => [
    numberInput(
      "dg",
      "直立−平伏自由能差（kJ/mol）",
      -25,
      25,
      data.defaultDeltaG,
    ),
    numberInput("t", "温度（K）", 250, 350, 298.15),
  ],
  calculate: chairEquilibrium,
  run({ dg, t }, data) {
    const v = chairEquilibrium(dg, t),
      printed =
        t === data.referenceTemperature
          ? data.rows.find((row) => row.deltaG === dg)
          : undefined;
    return {
      summary: `平伏:直立 = ${v.ratio.toFixed(2)}:1；平伏 ${(v.equatorial * 100).toFixed(2)}%，直立 ${(v.axial * 100).toFixed(2)}%。`,
      readouts: printed
        ? [
            {
              label: data.referenceLabel,
              value: `K ${printed.lowerBound ? ">" : "="} ${printed.k}，平伏 ${printed.lowerBound ? ">" : ""}${printed.percent}%。`,
            },
          ]
        : [],
    };
  },
};

// Pure numerical helpers shared by model tests.
organicChemistryModels["enantioselectivity-energy"].calculate = {
  assumedKelvin,
  ddG,
  eeFromDdG,
  eeToEr,
  erToEe,
  kelvin,
  pointGap,
  toKcal,
};
organicChemistryModels["radical-selectivity"].calculate = {
  closureRatio,
  derive,
  distribution,
  factor,
  offered,
  winner,
};

/** The two scales Table 1.1 of C&S prints side by side; values never cross between them. */

export const scales = [
  { id: "dmso", label: "DMSO" },
  { id: "water", label: "水与醇类溶剂" },
];

/** One printed number and where it is printed; a scale may list several when the sources disagree. */

function checkValues(id, values) {
  const entries = Object.entries(values);
  if (!entries.length) throw new Error(`${id} has no printed value`);
  for (const [scale, list] of entries) {
    if (scale !== "water" && scale !== "dmso")
      throw new Error(`${id} uses an unknown scale ${scale}`);
    if (!Array.isArray(list) || !list.length)
      throw new Error(`${id} lists no value on ${scale}`);
    for (const { value, source } of list)
      if (
        !Number.isFinite(value) ||
        typeof source !== "string" ||
        !source.trim()
      )
        throw new Error(`${id} has a value without a number or a source`);
  }
}

function validatePkaData(data, scale) {
  const text = (v) => typeof v === "string" && v.trim().length > 0;
  if (
    !data ||
    !Array.isArray(data.donors) ||
    !data.donors.length ||
    !Array.isArray(data.bases) ||
    !data.bases.length
  )
    throw new Error("缺少 pKa 数据");
  const ids = new Set();
  for (const [items, label] of [
    [data.donors, "name"],
    [data.bases, "acid"],
  ]) {
    for (const item of items) {
      if (
        !item ||
        !text(item.id) ||
        ids.has(item.id) ||
        !text(item.label) ||
        !text(item[label]) ||
        !item.values
      )
        throw new Error("pKa 条目无效或重复");
      ids.add(item.id);
      checkValues(item.id, item.values);
    }
  }
  for (const [key, items] of [
    ["donorId", data.donors],
    ["baseId", data.bases],
  ])
    if (!onScale(items, scale).some((item) => item.id === data.defaults?.[key]))
      throw new Error("pKa 默认选项须在当前标尺上有值");
}

/** Entries that have a printed value on the scale, in ascending order of their first value. */
export function onScale(items, scale) {
  return items
    .filter((item) => item.values[scale])
    .sort((a, b) => a.values[scale][0].value - b.values[scale][0].value);
}

/** ΔpKa at or beyond this many units counts as complete or negligible (textbook threshold of 3 to 4 units). */
export const margin = 3;

/**
 * HA + B⁻ ⇌ A⁻ + HB in one solvent: log K = pKa(HB) − pKa(HA). The numbers
 * must come from the same scale; ion pairing and aggregation are not modelled.
 */
export function deprotonation(donorPka, acidPka) {
  if (!Number.isFinite(donorPka) || !Number.isFinite(acidPka))
    throw new Error("pKa 必须是有限数值");
  const delta = acidPka - donorPka;
  const outcome =
    delta >= margin ? "full" : delta <= -margin ? "trace" : "mixture";
  return { delta, K: 10 ** delta, outcome };
}

/** Every printed donor value paired with every printed base value on one scale. */
export function readings(donor, base, scale) {
  return (donor.values[scale] ?? []).flatMap((d) =>
    (base.values[scale] ?? []).map((b) => ({
      donor: d,
      base: b,
      ...deprotonation(d.value, b.value),
    })),
  );
}

const pkaOutcomeText = {
  full: "基本完全去质子化",
  mixture: "平衡混合，两边都有",
  trace: "烯醇负离子痕量，只够催化",
};
const pkaPower = (k) => {
  const supers = {
    "-": "⁻",
    0: "⁰",
    1: "¹",
    2: "²",
    3: "³",
    4: "⁴",
    5: "⁵",
    6: "⁶",
    7: "⁷",
    8: "⁸",
    9: "⁹",
  };
  const [mantissa, exponent] = k.toExponential(1).split("e");
  return `${mantissa}×10${String(Number(exponent))
    .split("")
    .map((c) => supers[c])
    .join("")}`;
};
for (const scale of scales) {
  organicChemistryModels[`enolates-pka-${scale.id}`] = {
    validateData: (data) => validatePkaData(data, scale.id),
    inputs: (data) => [
      {
        id: "donorId",
        label: "供体（C–H 酸）",
        kind: "select",
        options: onScale(data.donors, scale.id).map((d) => ({
          value: d.id,
          label: d.label,
        })),
        default: data.defaults.donorId,
      },
      {
        id: "baseId",
        label: "碱",
        kind: "select",
        options: onScale(data.bases, scale.id).map((b) => ({
          value: b.id,
          label: b.label,
        })),
        default: data.defaults.baseId,
      },
    ],
    calculate: {
      deprotonation,
      readings,
      onScale,
      margin,
      scales,
    },
    run({ donorId, baseId }, data) {
      const d = data.donors.find((d) => d.id === donorId),
        b = data.bases.find((b) => b.id === baseId);
      if (!d || !b) throw new Error("请选择供体与碱");
      const result = readings(d, b, scale.id);
      if (!result.length)
        return { summary: "所选的供体和碱在这把标尺上没有同时印出的值。" };
      return {
        readouts: result.map((r, i) => ({
          label: `${i + 1} · ${d.name} pKa ${r.donor.value}（${r.donor.source}）；${b.acid} pKa ${r.base.value}（${r.base.source}）。`,
          value: `ΔpKa = ${r.base.value} − ${r.donor.value} = ${r.delta >= 0 ? "+" : "−"}${Math.abs(r.delta).toFixed(1)}，K = ${pkaPower(r.K)}：${pkaOutcomeText[r.outcome]}。`,
        })),
      };
    },
  };
}

export const strategyHammett = (() => {
  /**
   * Standard pKa values of para- and meta-substituted benzoic acids
   * and the printed substituent constants. σ is the pKa of benzoic acid minus
   * the pKa of the substituted acid, so a withdrawing group (a stronger acid)
   * has a positive σ.
   */
  function finite(value, what) {
    if (!Number.isFinite(value))
      throw new Error(`${what} must be a finite number`);
  }

  /** σ = pKa(benzoic acid) − pKa(substituted acid), rounded to the table's 0.01. */
  function sigma(pkaH, pkaX) {
    finite(pkaH, "pKa");
    finite(pkaX, "pKa");
    return Math.round((pkaH - pkaX) * 100) / 100;
  }

  /** log(kX/kH) = ρσ. A model value from ρ and σ, not a measured rate. */
  function logRelativeRate(rho, sigmaValue) {
    finite(rho, "ρ");
    finite(sigmaValue, "σ");
    return rho * sigmaValue;
  }

  function relativeRate(rho, sigmaValue) {
    return 10 ** logRelativeRate(rho, sigmaValue);
  }

  function pka(s, position) {
    return position === "para" ? s.pkaPara : s.pkaMeta;
  }
  function printedSigma(s, position) {
    return position === "para" ? s.sigmaPara : s.sigmaMeta;
  }

  /**
   * The figure leaves the gap between ±4 and ±5 open; the text calls −4.5 (SN1)
   * and +4.9 (SNAr) large, so 4.5 is the boundary used here.
   */
  function bandOf(rho) {
    finite(rho, "ρ");
    const size = Math.abs(rho);
    if (size <= 1) return "small";
    if (size < 4.5) return rho < 0 ? "moderate-negative" : "moderate-positive";
    return rho < 0 ? "large-negative" : "large-positive";
  }

  return {
    sigma,
    logRelativeRate,
    relativeRate,
    pka,
    printedSigma,
    bandOf,
  };
})();

function validateHammettData(data) {
  const text = (v) => typeof v === "string" && v.trim().length > 0;
  if (!data || !Number.isFinite(data.referencePka))
    throw new Error("缺少 Hammett 参照 pKa");
  for (const [key, fields] of [
    ["substituents", ["pkaPara", "pkaMeta", "sigmaPara", "sigmaMeta"]],
    ["reactions", ["rho"]],
  ]) {
    if (!Array.isArray(data[key]) || !data[key].length)
      throw new Error("缺少 Hammett 条目");
    const ids = new Set();
    for (const item of data[key]) {
      if (
        !item ||
        !text(item.id) ||
        ids.has(item.id) ||
        !text(item.name) ||
        !fields.every((field) => Number.isFinite(item[field]))
      )
        throw new Error("Hammett 条目无效或重复");
      ids.add(item.id);
    }
  }
  if (
    !data.substituents.some((s) => s.id === data.defaults?.subId) ||
    !data.reactions.some((r) => r.id === data.defaults?.reaction) ||
    !["para", "meta"].includes(data.defaults?.sigmaPosition) ||
    !["para", "meta"].includes(data.defaults?.ratePosition)
  )
    throw new Error("Hammett 默认选项无效");
}
const strategySubInput = (data) => ({
  id: "subId",
  label: "取代基",
  kind: "select",
  options: data.substituents.map((s) => ({ value: s.id, label: s.name })),
  default: data.defaults.subId,
});
const strategyPositionInput = {
  id: "position",
  label: "位置",
  kind: "select",
  options: [
    { value: "para", label: "对位（p）" },
    { value: "meta", label: "间位（m）" },
  ],
};
Object.assign(organicChemistryModels, {
  "strategy-hammett-sigma": {
    validateData: validateHammettData,
    inputs: (data) => [
      strategySubInput(data),
      { ...strategyPositionInput, default: data.defaults.sigmaPosition },
      numberInput("guess", "你算出的 σ", -10, 10, 0, 0.01),
    ],
    calculate: strategyHammett,
    run({ subId, position, guess }, data) {
      const s = data.substituents.find((s) => s.id === subId);
      if (!s || !["para", "meta"].includes(position) || !Number.isFinite(guess))
        throw new Error("请选择取代基、位置，并输入有限数值");
      const acid = strategyHammett.pka(s, position),
        value = strategyHammett.sigma(data.referencePka, acid);
      return {
        summary: `${position === "para" ? "对位" : "间位"} ${s.name} 取代的苯甲酸 pKa = ${acid}`,
        revealed: {
          summary: `${Math.abs(guess - value) < 0.005 ? "算对了。" : "再算一次。"}σ = ${data.referencePka} − ${acid} = ${value}，教材表中为 ${strategyHammett.printedSigma(s, position)}。`,
        },
      };
    },
  },
  "strategy-hammett-rate": {
    validateData: validateHammettData,
    inputs: (data) => [
      {
        id: "reaction",
        label: "反应",
        kind: "select",
        options: data.reactions.map((r) => ({
          value: r.id,
          label: `${r.name}（ρ = ${r.rho}）`,
        })),
        default: data.defaults.reaction,
      },
      strategySubInput(data),
      { ...strategyPositionInput, default: data.defaults.ratePosition },
    ],
    calculate: strategyHammett,
    run({ reaction, subId, position }, data) {
      const r = data.reactions.find((r) => r.id === reaction),
        s = data.substituents.find((s) => s.id === subId);
      if (!r || !s || !["para", "meta"].includes(position))
        throw new Error("请选择反应、取代基和位置");
      const value = strategyHammett.printedSigma(s, position),
        ratio = strategyHammett.relativeRate(r.rho, value);
      const points = data.substituents
        .flatMap((s) =>
          ["para", "meta"].map((p) => {
            const x = strategyHammett.printedSigma(s, p);
            return { x, y: r.rho * x };
          }),
        )
        .sort((a, b) => a.x - b.x);
      return {
        summary: `ρ = ${r.rho > 0 ? "+" : ""}${r.rho}，σ = ${value}：kX/kH = 10^${(r.rho * value).toFixed(2)} ≈ ${Number(ratio.toPrecision(2))}`,
        charts: [
          {
            title: `log(kX/kH) 对 σ，ρ = ${r.rho}，共 ${points.length} 个点`,
            xLabel: "σ",
            yLabel: "log(kX/kH)",
            xDomain: [-0.8, 0.9],
            yDomain: [
              -Math.max(1, Math.ceil(Math.abs(r.rho) * 0.8)),
              Math.max(1, Math.ceil(Math.abs(r.rho) * 0.8)),
            ],
            points,
          },
        ],
      };
    },
  },
});

export const safety = (() => {
  /** Concentrations are molar; mass concentration needs a molecular weight and is rejected. */
  function toMicromolar(value, unit) {
    if (!Number.isFinite(value) || value < 0)
      throw new Error("浓度须为有限非负数");
    const scale = { µM: 1, nM: 0.001, mM: 1000 }[unit];
    if (scale === undefined) throw new Error("仅支持 µM、nM、mM");
    const result = value * scale;
    if (!Number.isFinite(result)) throw new Error("浓度超出计算范围");
    return result;
  }
  /** hERG IC50 / unbound Cmax, both converted to µM. No universal pass/fail cutoff. */
  function safetyWindow(ic50, ic50Unit, cmax, cmaxUnit) {
    const numerator = toMicromolar(ic50, ic50Unit);
    const denominator = toMicromolar(cmax, cmaxUnit);
    if (numerator <= 0 || denominator <= 0)
      throw new Error("IC50 与游离 Cmax 必须大于零");
    const result = numerator / denominator;
    if (!Number.isFinite(result)) throw new Error("倍数超出计算范围");
    return result;
  }
  /** Linear PK, constant bioavailability, competitive reversible inhibition of one clearance pathway.
   * Iu and Ki are µM. fm is fraction of baseline clearance through the inhibited pathway.
   * Excludes gut first pass, induction, TDI, transporters and active metabolite kinetics.
   */
  function aucRatio(iu, ki, fm) {
    if (
      ![iu, ki, fm].every(Number.isFinite) ||
      iu < 0 ||
      ki <= 0 ||
      fm < 0 ||
      fm > 1
    )
      throw new Error("Iu ≥ 0、Ki > 0，fm 在 0–1 之间");
    const result = 1 / (1 - fm + fm / (1 + iu / ki));
    if (!Number.isFinite(result)) throw new Error("AUC 倍数超出计算范围");
    return result;
  }

  /** Columns of Abi-Gerges 2011 Table 1 as printed: concentrations in µM, one set per channel (1a homomer, 1a/1b heteromer). */
  const hergMarginColumns = [
    {
      key: "eftpc",
      label: "EFTPCmax（范围取上端）",
      unit: "µM",
      sourceUnit: "µM",
      scale: "log",
    },
    {
      key: "eftpcLow",
      label: "EFTPCmax 范围下端",
      unit: "µM",
      sourceUnit: "µM",
      scale: "log",
    },
    ...[
      ["_1a", "1a"],
      ["_1a1b", "1a/1b"],
    ].flatMap(([suffix, channel]) => [
      {
        key: `ic50${suffix}`,
        label: `${channel} IC50`,
        unit: "µM",
        sourceUnit: "µM",
        scale: "log",
      },
      {
        key: `lcl${suffix}`,
        label: `${channel} 95% 下限`,
        unit: "µM",
        sourceUnit: "µM",
        scale: "log",
      },
      {
        key: `ucl${suffix}`,
        label: `${channel} 95% 上限`,
        unit: "µM",
        sourceUnit: "µM",
        scale: "log",
      },
      {
        key: `pic50${suffix}`,
        label: `${channel} pIC50`,
        scale: "linear",
      },
      {
        key: `hill${suffix}`,
        label: `${channel} Hill 系数`,
        scale: "linear",
      },
      {
        key: `margin${suffix}`,
        label: `${channel} Margin`,
        scale: "log",
      },
    ]),
  ];

  /** One ECG reading: RR and QT as measured, QTc as the source printed it (ms). */

  /** Honig 1993 Table 2, JAMA 269, p. 1516 (PDF 4): the six subjects as printed. */
  const honigSubjects = [
    {
      subject: 1,
      baseline: { rr: 750, qt: 350, qtc: 404 },
      alone: { rr: 1071, qt: 418, qtc: 404 },
      ketoconazole: { rr: 833, qt: 440, qtc: 482 },
    },
    {
      subject: 2,
      baseline: { rr: 1000, qt: 390, qtc: 390 },
      alone: { rr: 857, qt: 375, qtc: 405 },
      ketoconazole: { rr: 833, qt: 440, qtc: 482 },
    },
    {
      subject: 3,
      baseline: { rr: 769, qt: 369, qtc: 421 },
      alone: { rr: 760, qt: 363, qtc: 416 },
      ketoconazole: { rr: 750, qt: 430, qtc: 497 },
    },
    {
      subject: 4,
      baseline: { rr: 939, qt: 378, qtc: 390 },
      alone: { rr: 780, qt: 370, qtc: 419 },
      ketoconazole: { rr: 1000, qt: 440, qtc: 440 },
    },
    {
      subject: 5,
      baseline: { rr: 1072, qt: 412, qtc: 398 },
      alone: { rr: 1154, qt: 436, qtc: 406 },
      ketoconazole: { rr: 1000, qt: 460, qtc: 460 },
    },
    {
      subject: 6,
      baseline: { rr: 800, qt: 396, qtc: 443 },
      alone: { rr: 1034, qt: 451, qtc: 444 },
      ketoconazole: { rr: 1111, qt: 576, qtc: 546 },
    },
  ];

  /** The Mean±SEM row of Table 2, as printed ("402±165" is the source's own typo). */
  const honigPrintedMeans = {
    baseline: { rr: "888±55", qt: "383±9", qtc: "408±8" },
    alone: { rr: "943±67", qt: "402±165", qtc: "416±6" },
    ketoconazole: { rr: "921±56", qt: "464±23", qtc: "490±16" },
  };

  /** Bazett: QTc = QT / √RR with RR in seconds; QT and RR in ms, QTc in ms. */
  function bazett(qt, rr) {
    if (![qt, rr].every(Number.isFinite) || qt <= 0 || rr <= 0)
      throw new Error("QT 与 RR 须为正数（毫秒）");
    return qt / Math.sqrt(rr / 1000);
  }

  /** Mean and standard error of the mean (sample SD / √n), as the source's SEM. */
  function meanSem(values) {
    if (values.length < 2 || !values.every(Number.isFinite))
      throw new Error("至少需要两个有限数值");
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const variance =
      values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
    return { mean, sem: Math.sqrt(variance / values.length) };
  }

  return {
    toMicromolar,
    safetyWindow,
    aucRatio,
    hergMarginColumns,
    honigSubjects,
    honigPrintedMeans,
    bazett,
    meanSem,
  };
})();

export const routeComparison = (() => {
  /** Total mass inputs include water and work-up; no recycling credit. All units kg. */
  function calculatePmi(totalInputKg, productKg) {
    if (totalInputKg === null || productKg === null) return null;
    if (
      !Number.isFinite(totalInputKg) ||
      !Number.isFinite(productKg) ||
      totalInputKg < 0 ||
      productKg <= 0 ||
      productKg > totalInputKg
    )
      throw new Error("投入须非负，产品须大于零且不超过总投入");
    return totalInputKg / productKg;
  }
  /** Isolated yields for a single continuous branch only, each as a fraction. */
  function linearYield(yields) {
    if (
      !yields.length ||
      yields.some((y) => !Number.isFinite(y) || y < 0 || y > 1)
    )
      throw new Error("各步收率须在0到1之间，至少提供一步");
    return yields.reduce((product, y) => product * y, 1);
  }
  /** Cumulative product after each step of a continuous branch, each yield a fraction. */
  function runningProduct(yields) {
    linearYield(yields);
    let product = 1;
    return yields.map((y) => (product *= y));
  }
  const atomicWeight = {
    C: 12.011,
    H: 1.008,
    F: 18.998,
    N: 14.007,
    O: 15.999,
  };
  /** Average molecular weight in g/mol of a plain formula such as C30H30F2N6O3. */
  function formulaWeight(formula) {
    const atoms = [...formula.matchAll(/([A-Z][a-z]?)(\d*)/g)];
    if (!atoms.length || atoms.map((m) => m[0]).join("") !== formula)
      throw new Error(`分子式无法解析：${formula}`);
    return atoms.reduce((sum, [, element, count]) => {
      if (!(element in atomicWeight))
        throw new Error(`没有 ${element} 的原子量`);
      return sum + atomicWeight[element] * (count === "" ? 1 : Number(count));
    }, 0);
  }
  /** Molar yield as a fraction: grams isolated, their formula weight, and mol that went in. */
  function molarYield(grams, weight, startMol) {
    if (![grams, weight, startMol].every((x) => Number.isFinite(x) && x > 0))
      throw new Error("质量、分子量和起始物质的量都须大于零");
    return grams / weight / startMol;
  }
  /**
   * Mass in kg of the starting material and every intermediate that must be
   * bought or made to deliver `apiKg`, along one linear sequence. Every compound
   * has the same molecular weight and the API itself is not counted, as in the
   * model of Anderson, Practical Process Research and Development, Figure 3.14.
   */
  function intermediateMass(apiKg, stepYields) {
    if (!Number.isFinite(apiKg) || apiKg <= 0)
      throw new Error("API 的质量须大于零");
    if (stepYields.some((y) => y <= 0)) throw new Error("各步收率须大于零");
    linearYield(stepYields);
    let needed = apiKg;
    let total = 0;
    for (let i = stepYields.length - 1; i >= 0; i--) {
      needed /= stepYields[i];
      total += needed;
    }
    return total;
  }
  /**
   * `intermediateMass` for one resolution among `steps` steps, once per position
   * (the first entry puts the resolution first).
   */
  function resolutionTotals(apiKg, resolutionYield, otherYield, steps) {
    if (!Number.isInteger(steps) || steps < 1)
      throw new Error("步数须是正整数");
    return Array.from({ length: steps }, (_, position) =>
      intermediateMass(
        apiKg,
        Array.from({ length: steps }, (_, i) =>
          i === position ? resolutionYield : otherYield,
        ),
      ),
    );
  }

  return {
    calculatePmi,
    linearYield,
    runningProduct,
    formulaWeight,
    molarYield,
    intermediateMass,
    resolutionTotals,
  };
})();

const safetyUnit = (id, label, value) => ({
  id,
  label,
  kind: "select",
  options: ["µM", "nM", "mM"].map((value) => ({ value, label: value })),
  default: value,
});
Object.assign(organicChemistryModels, {
  "safety-window": {
    inputs: [
      numberInput("ic50", "hERG IC50", 0, 1e9, 0.95, 0.01),
      safetyUnit("icUnit", "IC50 单位", "µM"),
      numberInput("cmax", "游离 Cmax", 0, 1e9, 9, 0.01),
      safetyUnit("cmaxUnit", "Cmax 单位", "nM"),
    ],
    calculate: safety,
    run({ ic50, icUnit, cmax, cmaxUnit }) {
      return {
        summary: `安全窗口：${Number(safety.safetyWindow(ic50, icUnit, cmax, cmaxUnit).toPrecision(5))} 倍`,
      };
    },
  },
  "safety-cyp": {
    inputs: [
      numberInput("iu", "Iu（µM）", 0, 1e6, 1),
      numberInput("ki", "Ki（µM）", 0, 1e6, 1),
      numberInput("fm", "fm（0–1）", 0, 1, 0.8),
    ],
    calculate: safety,
    run({ iu, ki, fm }) {
      return {
        summary: `AUC 倍数：${Number(safety.aucRatio(iu, ki, fm).toPrecision(4))}`,
      };
    },
  },
  "safety-qtc": {
    inputs: [
      numberInput("rr", "RR（ms）", 0, 10000, 1000, 1),
      numberInput("qt", "QT（ms）", 0, 10000, 440, 1),
    ],
    calculate: safety,
    run({ rr, qt }) {
      return { summary: `QTc = ${safety.bazett(qt, rr).toFixed(1)} ms` };
    },
  },
  "route-pmi": {
    inputs: [
      numberInput("input", "总投入（kg）", 0, 1e9, 1000, 1),
      numberInput("product", "隔离产品（kg）", 0, 1e9, 20, 1),
      {
        id: "available",
        label: "投入资料",
        kind: "select",
        options: [
          { value: "complete", label: "完整" },
          { value: "missing", label: "缺失" },
        ],
        default: "complete",
      },
    ],
    calculate: routeComparison,
    run({ input, product, available }) {
      const result = routeComparison.calculatePmi(
        available === "missing" ? null : input,
        product,
      );
      return {
        summary:
          result === null
            ? "未报告/不可计算：需要完整投入与产品质量"
            : `PMI = ${result.toFixed(1)} kg/kg`,
      };
    },
  },
  "route-resolution": {
    inputs: [
      numberInput("api", "生产的 API（kg）", 1, 1e6, 100, 10),
      numberInput("other", "其余各步的收率（%）", 1, 100, 90, 1),
      numberInput("resolution", "拆分步的收率（%）", 1, 100, 50, 1),
      {
        id: "position",
        label: "拆分位置",
        kind: "select",
        options: Array.from({ length: 7 }, (_, i) => ({
          value: i + 1,
          label: `第 ${i + 1} 步`,
        })),
        default: 1,
      },
    ],
    calculate: routeComparison,
    run({ api, other, resolution, position }) {
      const totals = routeComparison.resolutionTotals(
        api,
        resolution / 100,
        other / 100,
        7,
      );
      if (!Number.isInteger(Number(position)) || position < 1 || position > 7)
        throw new Error("请选择第1至7步");
      return {
        summary: `拆分放在第 ${position} 步：${totals[position - 1].toFixed(0)} kg。放在第 7 步比放在第 1 步多 ${((totals[6] / totals[0] - 1) * 100).toFixed(0)}%。`,
        readouts: totals.map((total, i) => ({
          label: `第 ${i + 1} 步`,
          value: `${total.toFixed(0)} kg；相对位置 1：${((total / totals[0]) * 100).toFixed(0)}%`,
        })),
        charts: [
          {
            title: "拆分放在第几步，需要的中间体总量（kg）",
            xLabel: "拆分位置",
            yLabel: "总量（kg）",
            points: totals.map((y, i) => ({ x: i + 1, y })),
          },
        ],
      };
    },
  },
  "route-ledger": {
    validateData(data) {
      const object = (v) =>
        v !== null && typeof v === "object" && !Array.isArray(v);
      const text = (v) => typeof v === "string" && v.trim().length > 0;
      const fraction = (v) => Number.isFinite(v) && v >= 0 && v <= 1;
      const require = (condition, field) => {
        if (!condition) throw new Error(`路线数据 ${field} 无效`);
      };
      require(object(data), "ledger");
      require(text(data.inputLabel), "inputLabel");
      require(Array.isArray(data.routes) && data.routes.length > 0, "routes");
      for (const route of data.routes) {
        require(object(route) &&
          text(route.title) &&
          text(route.claimedText), "route");
        require(fraction(route.claimed), "route.claimed");
        require(Array.isArray(route.steps) && route.steps.length > 0, "steps");
        for (const step of route.steps) {
          require(object(step) && text(step.name) && text(step.note), "step");
          require(fraction(step.yield), "step.yield");
          require(step.assumed === undefined ||
            typeof step.assumed === "boolean", "step.assumed");
        }
      }
      const m = data.mass;
      require(object(m) && text(m.title), "mass");
      require(fraction(m.claimed), "mass.claimed");
      for (const field of ["startFormula", "productFormula"]) {
        require(text(m[field]), field);
        positive(routeComparison.formulaWeight(m[field]), field);
      }
      for (const field of ["startGrams", "startMol", "productGrams"])
        positive(m[field], field);
    },
    inputs: (data) => [numberInput("assumed", data.inputLabel, 0, 100, 100, 1)],
    calculate: routeComparison,
    run({ assumed }, data) {
      const percent = (x) => `${(x * 100).toFixed(1)}%`;
      const tables = [];
      const readouts = data.routes.flatMap((route) => {
        const yields = route.steps.map((s) =>
            s.assumed ? assumed / 100 : s.yield,
          ),
          cumulative = routeComparison.runningProduct(yields),
          product = cumulative.at(-1);
        tables.push({
          caption: route.title,
          columns: ["步骤", "收率", "累计", "原文备注"],
          rows: route.steps.map((step, i) => [
            step.name,
            percent(yields[i]),
            percent(cumulative[i]),
            step.note,
          ]),
        });
        return [
          {
            label: route.title,
            value: `相乘 ${percent(product)}；论文写 ${route.claimedText}，相差 ${Math.abs((product - route.claimed) * 100).toFixed(1)} 个百分点。`,
          },
        ];
      });
      const m = data.mass,
        pw = routeComparison.formulaWeight(m.productFormula),
        sw = routeComparison.formulaWeight(m.startFormula);
      readouts.push({
        label: m.title,
        value: `${m.productGrams} g ÷ ${pw.toFixed(1)} g/mol = ${((m.productGrams / pw) * 1000).toFixed(2)} mmol，按原文的 ${m.startMol * 1000} mmol 起点是 ${percent(routeComparison.molarYield(m.productGrams, pw, m.startMol))}；按 ${m.startGrams} g 起点（${((m.startGrams / sw) * 1000).toFixed(2)} mmol）是 ${percent(routeComparison.molarYield(m.productGrams, pw, m.startGrams / sw))}。论文写 ${percent(m.claimed)}。`,
      });
      return { readouts, tables };
    },
  },
});
