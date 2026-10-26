/**
 * Binding and induced-proximity teaching models. Concentrations are nM, time is h. Equilibrium,
 * mass conservation and constant synthesis assumptions define these teaching models.
 * Slider inputs marked log10 are exponents; calculations use 10 ** input.
 */
function samples(from, to, count = 180) {
  return Array.from(
    { length: count + 1 },
    (_, index) => from + ((to - from) * index) / count,
  );
}
/** Compact number formatting used by labels and read-outs. */
function formatValue(value) {
  if (value === 0) return "0";
  if (value >= 1e4) return (value / 1e3).toFixed(value % 1e3 ? 1 : 0) + "k";
  if (value >= 100) return value.toFixed(0);
  if (value >= 10) return value.toFixed(1).replace(/\.0$/, "");
  if (value >= 1) return value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return value.toPrecision(2);
}
/** Equilibrium occupancy (%) of a single site: θ = L / (Kd + L). */
function occupancy(kd, ligand) {
  return (100 * ligand) / (kd + ligand);
}
/**
 * Occupancy (%) over 24 h for a ligand with Kd = 10 nM: 100 nM free ligand
 * for the first 2 h, then complete washout without rebinding.
 */
function associationCurve(kon) {
  const koff = 10 * kon;
  const ligand = 100;
  const equilibrium = ligand / (ligand + 10);
  const rate = kon * ligand + koff;
  const atWashout = equilibrium * (1 - Math.exp(-rate * 2));
  const curve = samples(0, 24, 480).map((t) => [
    t,
    100 *
      (t <= 2
        ? equilibrium * (1 - Math.exp(-rate * t))
        : atWashout * Math.exp(-koff * (t - 2))),
  ]);
  return { koff, residence: 1 / koff, curve };
}
/**
 * Three-body equilibrium for a free drug concentration with binary
 * dissociation constants kt, ke and cooperativity alpha.
 */
function ternaryFree(
  drug,
  kt,
  ke,
  alpha,
  targetTotal = 100,
  effectorTotal = 100,
) {
  if (drug <= 0) {
    return {
      ternary: 0,
      target: targetTotal,
      effector: effectorTotal,
      targetBinary: 0,
      effectorBinary: 0,
      drug: 0,
      drugTotal: 0,
    };
  }
  const c = (alpha * drug) / (kt * ke * (1 + drug / kt) * (1 + drug / ke));
  const b = 1 + c * (targetTotal + effectorTotal);
  const discriminant = Math.max(
    0,
    b * b - 4 * c * c * targetTotal * effectorTotal,
  );
  const ternary =
    c > 0
      ? (2 * c * targetTotal * effectorTotal) / (b + Math.sqrt(discriminant))
      : 0;
  const target = (targetTotal - ternary) / (1 + drug / kt);
  const effector = (effectorTotal - ternary) / (1 + drug / ke);
  const targetBinary = (target * drug) / kt;
  const effectorBinary = (effector * drug) / ke;
  return {
    ternary,
    target,
    effector,
    targetBinary,
    effectorBinary,
    drug,
    drugTotal: drug + targetBinary + effectorBinary + ternary,
  };
}
/** Same equilibrium solved for a total drug concentration by bisection. */
function ternaryTotal(
  drugTotal,
  kt,
  ke,
  alpha,
  targetTotal = 100,
  effectorTotal = 100,
) {
  let low = 0;
  let high = drugTotal;
  for (let step = 0; step < 65; step++) {
    const drug = (low + high) / 2;
    const state = ternaryFree(drug, kt, ke, alpha, targetTotal, effectorTotal);
    if (state.drugTotal > drugTotal) high = drug;
    else low = drug;
  }
  return ternaryFree(
    (low + high) / 2,
    kt,
    ke,
    alpha,
    targetTotal,
    effectorTotal,
  );
}
/** Protein loss (%) from baseline for a hyperbolic concentration response. */
function degradation(dmax, halfMax, drug) {
  return (dmax * drug) / (halfMax + drug);
}
/**
 * Concentration giving an absolute 50 % loss, or null when Dmax ≤ 50 %
 * makes it unreachable at finite concentration.
 */
function absoluteHalfLoss(dmax, halfMax) {
  return dmax > 50 ? (halfMax * 50) / (dmax - 50) : null;
}
/**
 * Protein level (% of baseline) at time t (h) with basal half-life
 * `halfLife`, an added first-order degradation rate `kdeg` (h⁻¹) until
 * `washout`, and baseline synthesis throughout.
 */
function degradationLevel(halfLife, kdeg, washout, t) {
  const basal = Math.LN2 / halfLife;
  const steady = basal / (basal + kdeg);
  const atWashout = steady + (1 - steady) * Math.exp(-(basal + kdeg) * washout);
  return (
    100 *
    (t <= washout
      ? steady + (1 - steady) * Math.exp(-(basal + kdeg) * t)
      : 1 + (atWashout - 1) * Math.exp(-basal * (t - washout)))
  );
}
/** The same level sampled over 72 h. */
function degradationKinetics(halfLife, kdeg, washout) {
  return samples(0, 72, 300).map((t) => [
    t,
    degradationLevel(halfLife, kdeg, washout, t),
  ]);
}
/**
 * Protein level (%) `hours` after the drug is gone, from `start` (%): constant
 * synthesis and first-order loss with the basal half-life `halfLife`.
 */
function washoutRecovery(start, halfLife, hours) {
  return 100 - (100 - start) * Math.exp((-Math.LN2 / halfLife) * hours);
}
/**
 * Basal half-life (h) that lets the level climb from `start` (%) to `target`
 * (%) within `hours`, in the same model as washoutRecovery.
 */
function halfLifeForRecovery(start, target, hours) {
  if (!(start < target && target < 100))
    throw new RangeError("target must lie between start and 100 %");
  return (Math.LN2 * hours) / -Math.log((100 - target) / (100 - start));
}
/**
 * RIPTAC selectivity sketch: effector protein (EP, 50 nM) distribution at a
 * free drug concentration for a given target protein (TP) level.
 */
function riptacDistribution(targetProtein, drug) {
  return ternaryFree(drug, 20, 20, 10, targetProtein, 50);
}
/**
 * Total drug (1000 nM initial, first-order elimination) and protein level,
 * both normalised to their starting values, over 48 h. Degradation rate
 * follows free drug through a saturable term cf / (10 + cf).
 */
function pkpd(pkHalfLife, unboundFraction, pdHalfLife) {
  const basal = Math.LN2 / pdHalfLife;
  const elimination = Math.LN2 / pkHalfLife;
  const step = 0.025;
  let protein = 1;
  const proteinCurve = [[0, 100]];
  const drugCurve = [[0, 100]];
  for (let index = 1; index <= 1920; index++) {
    const middle = (index - 0.5) * step;
    const free = unboundFraction * 1e3 * Math.exp(-elimination * middle);
    const rate = basal + free / (10 + free);
    const steady = basal / rate;
    protein = steady + (protein - steady) * Math.exp(-rate * step);
    if (index % 8 === 0) {
      const t = index * step;
      proteinCurve.push([t, protein * 100]);
      drugCurve.push([t, 100 * Math.exp(-elimination * t)]);
    }
  }
  return { drugCurve, proteinCurve };
}
export {
  absoluteHalfLoss,
  associationCurve,
  degradation,
  degradationKinetics,
  degradationLevel,
  formatValue,
  halfLifeForRecovery,
  occupancy,
  pkpd,
  riptacDistribution,
  samples,
  ternaryFree,
  ternaryTotal,
  washoutRecovery,
};

const proximityInputs = {
  Binding: [
    {
      id: "kd",
      label: "Kd（nM） · log10",
      kind: "number",
      control: "range",
      min: -1,
      max: 3,
      step: 0.05,
      default: 1,
    },
    {
      id: "ligand",
      label: "游离配体浓度（nM） · log10",
      kind: "number",
      control: "range",
      min: -2,
      max: 4,
      step: 0.05,
      default: 1,
    },
  ],
  Association: [
    {
      id: "konA",
      label: "配体 A 的 kon（nM⁻¹·h⁻¹） · log10",
      kind: "number",
      control: "range",
      min: -2,
      max: 0,
      step: 0.1,
      default: -2,
    },
    {
      id: "konB",
      label: "配体 B 的 kon（nM⁻¹·h⁻¹） · log10",
      kind: "number",
      control: "range",
      min: -2,
      max: 0,
      step: 0.1,
      default: -1,
    },
  ],
  Ternary: [
    {
      id: "kt",
      label: "目标端 Kd（nM） · log10",
      kind: "number",
      control: "range",
      min: -1,
      max: 3,
      step: 0.1,
      default: 1.7,
    },
    {
      id: "ke",
      label: "伙伴端 Kd（nM） · log10",
      kind: "number",
      control: "range",
      min: -1,
      max: 3,
      step: 0.1,
      default: 1.7,
    },
    {
      id: "alpha",
      label: "协同性 α · log10",
      kind: "number",
      control: "range",
      min: -1,
      max: 2,
      step: 0.1,
      default: 1,
    },
    {
      id: "drug",
      label: "总药物 Dtotal（nM） · log10",
      kind: "number",
      control: "range",
      min: -2,
      max: 5,
      step: 0.1,
      default: 2,
    },
  ],
  Degradation: [
    {
      id: "dmax",
      label: "Dmax（%）",
      kind: "number",
      control: "range",
      min: 20,
      max: 99,
      step: 1,
      default: 90,
    },
    {
      id: "halfMax",
      label: "曲线半最大浓度 C½（nM） · log10",
      kind: "number",
      control: "range",
      min: -1,
      max: 3,
      step: 0.1,
      default: 1,
    },
  ],
  Kinetics: [
    {
      id: "halfLife",
      label: "基础蛋白半衰期（h）",
      kind: "number",
      control: "range",
      min: 2,
      max: 100,
      step: 1,
      default: 12,
    },
    {
      id: "kdeg",
      label: "药物额外降解速率（h⁻¹）",
      kind: "number",
      control: "range",
      min: 0.02,
      max: 1,
      step: 0.02,
      default: 0.4,
    },
    {
      id: "washout",
      label: "撤药时间（h）",
      kind: "number",
      control: "range",
      min: 4,
      max: 24,
      step: 1,
      default: 12,
    },
  ],
  Selectivity: [
    {
      id: "tumor",
      label: "肿瘤模型 TP（nM）",
      kind: "number",
      control: "range",
      min: 0,
      max: 200,
      step: 1,
      default: 100,
    },
    {
      id: "normal",
      label: "正常模型 TP（nM）",
      kind: "number",
      control: "range",
      min: 0,
      max: 100,
      step: 1,
      default: 5,
    },
    {
      id: "drug",
      label: "胞内游离药物（nM） · log10",
      kind: "number",
      control: "range",
      min: -2,
      max: 3,
      step: 0.1,
      default: 1,
    },
  ],
  PkPd: [
    {
      id: "pkHalfLife",
      label: "药物消除半衰期（h）",
      kind: "number",
      control: "range",
      min: 1,
      max: 12,
      step: 1,
      default: 4,
    },
    {
      id: "unbound",
      label: "游离比例 fu（%）",
      kind: "number",
      control: "range",
      min: 1,
      max: 30,
      step: 1,
      default: 5,
    },
    {
      id: "pdHalfLife",
      label: "蛋白基础半衰期（h）",
      kind: "number",
      control: "range",
      min: 2,
      max: 36,
      step: 1,
      default: 12,
    },
  ],
};

const points = (pairs) => pairs.map(([x, y]) => ({ x, y }));
const readout = (label, value) => ({
  label,
  value: typeof value === "string" ? value : formatValue(value),
});
const chart = (title, xLabel, yLabel, series, xDomain, yDomain = [0, 100]) => ({
  title,
  xLabel,
  yLabel,
  series,
  xDomain,
  yDomain,
});
const series = (name, pairs, scatter = false) => ({
  name,
  points: points(pairs),
  ...(scatter ? { scatter: true } : {}),
});

/** @typedef {{ kind: "signal-peak" | "protein-decrease-peak" | "protein-time" | "protein-washout", dataset: string, name: string }} MeasuredOverlaySeries */

function validateOverlays(data, group, kinds) {
  const text = (v) => typeof v === "string" && v.trim().length > 0;
  const require = (valid, field) => {
    if (!valid) throw new Error(`实测叠加数据 ${field} 无效`);
  };
  const config = data?.overlays?.[group];
  require(config &&
    text(config.label) &&
    Array.isArray(config.choices) &&
    config.choices.length > 0, group);
  const values = new Set(["none"]);
  for (const choice of config.choices) {
    require(choice &&
      text(choice.value) &&
      !values.has(choice.value) &&
      text(choice.label), "choice");
    values.add(choice.value);
    require(Array.isArray(choice.series) && choice.series.length > 0, "series");
    for (const descriptor of choice.series) {
      require(descriptor &&
        kinds.includes(descriptor.kind) &&
        text(descriptor.name) &&
        text(descriptor.dataset) &&
        Object.hasOwn(data, descriptor.dataset), "descriptor");
      const r = data[descriptor.dataset];
      const dose =
        descriptor.kind === "signal-peak" ||
        descriptor.kind === "protein-decrease-peak";
      const x = dose ? r?.dose : r?.hours;
      const y = descriptor.kind === "signal-peak" ? r?.signal : r?.level;
      require(Array.isArray(x) &&
        x.length > 0 &&
        Array.isArray(y) &&
        x.length === y.length, "paired arrays");
      require(x.every(
        (v) =>
          Number.isFinite(v) &&
          (descriptor.kind === "signal-peak" ? v > 0 : v >= 0),
      ) && y.every((v) => Number.isFinite(v) && v >= 0), "measurements");
      if (descriptor.kind === "signal-peak")
        require(Math.max(...r.signal) > 0, "signal peak");
      if (descriptor.kind === "protein-decrease-peak")
        require(Math.max(...r.level.map((v) => 100 - v)) >
          0, "maximum protein decrease");
      if (descriptor.kind === "protein-washout")
        require([r.start, r.pretreatHours].every(
          (v) => Number.isFinite(v) && v >= 0,
        ), "washout start/offset");
    }
  }
}

function overlayInputs(numeric, config) {
  return [
    ...numeric,
    {
      id: "overlay",
      label: config.label,
      kind: "select",
      options: [
        { value: "none", label: "不叠加" },
        ...config.choices.map(({ value, label }) => ({ value, label })),
      ],
      default: "none",
    },
  ];
}

/** Transform the raw measurement without replacing its source values. @param {MeasuredOverlaySeries} descriptor */
function measuredSeries(descriptor, data) {
  const r = data[descriptor.dataset];
  let pairs;
  switch (descriptor.kind) {
    case "signal-peak": {
      const top = Math.max(...r.signal);
      pairs = r.dose.map((d, i) => [Math.log10(d), (r.signal[i] / top) * 100]);
      break;
    }
    case "protein-decrease-peak": {
      const top = Math.max(...r.level.map((v) => 100 - v));
      pairs = r.dose.flatMap((d, i) =>
        d > 0 ? [[Math.log10(d), ((100 - r.level[i]) / top) * 100]] : [],
      );
      break;
    }
    case "protein-time":
      pairs = r.hours.map((h, i) => [h, r.level[i]]);
      break;
    case "protein-washout":
      pairs = [
        [r.pretreatHours, r.start],
        ...r.hours.map((h, i) => [r.pretreatHours + h, r.level[i]]),
      ];
      break;
  }
  return series(descriptor.name, pairs, true);
}

function measuredOverlays(selected, data, group) {
  if (selected === "none") return [];
  return data.overlays[group].choices
    .find((choice) => choice.value === selected)
    .series.map((descriptor) => measuredSeries(descriptor, data));
}

/** @type {Record<string, import('./catalog.mjs').LabModel>} */
export const inducedProximityModels = {
  "binding-occupancy": {
    inputs: proximityInputs.Binding,
    run({ kd, ligand }) {
      kd = 10 ** kd;
      ligand = 10 ** ligand;
      return {
        readouts: [
          readout("受体占有率 θ", occupancy(kd, ligand).toFixed(1) + "%"),
        ],
        charts: [
          chart(
            "结合占有率随游离浓度的变化",
            "游离配体浓度 log10（nM）",
            "受体占有率（%）",
            [
              series(
                "平衡占有率",
                samples(-2, 4).map((x) => [x, occupancy(kd, 10 ** x)]),
              ),
            ],
            [-2, 4],
          ),
        ],
        summary:
          "横轴为对数浓度。降低 Kd 会使曲线左移，但不会自动证明这是拮抗剂。",
      };
    },
  },
  "binding-association-washout": {
    inputs: proximityInputs.Association,
    run({ konA, konB }) {
      const a = associationCurve(10 ** konA),
        b = associationCurve(10 ** konB);
      return {
        readouts: [
          readout("A：koff（h⁻¹）", a.koff),
          readout("A：τ（h）", a.residence),
          readout("B：koff（h⁻¹）", b.koff),
          readout("B：τ（h）", b.residence),
        ],
        summary: "相同 Kd 只约束比值，不约束各自速度。",
        charts: [
          chart(
            "Kd 相同但结合解离速率不同的配体占有率曲线",
            "时间（h）",
            "受体占有率（%）",
            [
              series("配体 A · Kd = 10 nM", a.curve),
              series("配体 B · Kd = 10 nM", b.curve),
            ],
            [0, 24],
          ),
        ],
      };
    },
  },
  "ternary-equilibrium": {
    validateData: (data) =>
      validateOverlays(data, "concentration", [
        "signal-peak",
        "protein-decrease-peak",
      ]),
    inputs: (data) =>
      overlayInputs(proximityInputs.Ternary, data.overlays.concentration),
    run({ kt, ke, alpha, drug, overlay }, data) {
      kt = 10 ** kt;
      ke = 10 ** ke;
      alpha = 10 ** alpha;
      drug = 10 ** drug;
      const sweep = samples(-2, 5, 240).map((x) => ({
        x,
        state: ternaryTotal(10 ** x, kt, ke, alpha),
      }));
      const current = ternaryTotal(drug, kt, ke, alpha),
        peak = sweep.reduce((best, item) =>
          item.state.ternary > best.state.ternary ? item : best,
        ),
        peakDose = 10 ** peak.x;
      const relative = overlay !== "none",
        scale = relative ? 100 / peak.state.ternary : 1;
      const curves = [
        series(
          relative ? "模型：TDE（相对峰值）" : "TDE / Ttotal（%）",
          sweep.map(({ x, state }) => [x, state.ternary * scale]),
        ),
      ];
      if (!relative)
        curves.push(
          series(
            "TD / Ttotal（%）",
            sweep.map(({ x, state }) => [x, state.targetBinary]),
          ),
        );
      curves.push(...measuredOverlays(overlay, data, "concentration"));
      return {
        readouts: [
          readout("游离 D（nM）", current.drug),
          readout("三元 TDE（nM）", current.ternary),
          readout("二元 TD（nM）", current.targetBinary),
          readout("模型峰位（nM）", peakDose),
          readout(
            "峰位 ×10 处（相对峰值 %）",
            (ternaryTotal(peakDose * 10, kt, ke, alpha).ternary /
              peak.state.ternary) *
              100,
          ),
          readout(
            "峰位 ×1000 处（相对峰值 %）",
            (ternaryTotal(peakDose * 1000, kt, ke, alpha).ternary /
              peak.state.ternary) *
              100,
          ),
        ],
        charts: [
          chart(
            relative
              ? "模型三元复合物与实测读数，均相对自身峰值"
              : "三元复合物与二元复合物随总药物浓度变化",
            "总药物浓度 Dtotal log10（nM）",
            relative ? "相对各自峰值（%）" : "目标蛋白物种比例（%）",
            curves,
            [-2, 5],
          ),
        ],
      };
    },
  },
  "degradation-response": {
    inputs: proximityInputs.Degradation,
    run({ dmax, halfMax }) {
      halfMax = 10 ** halfMax;
      const absolute = absoluteHalfLoss(dmax, halfMax);
      return {
        readouts: [
          readout("相对半最大终点", (dmax / 2).toFixed(1) + "% 下降"),
          readout("曲线半最大浓度 C½（nM）", halfMax),
          readout(
            "绝对下降 50%",
            absolute === null
              ? "有限浓度下不可达"
              : formatValue(absolute) + " nM",
          ),
        ],
        summary:
          absolute === null
            ? "最大效应不足以在有限浓度下达到该绝对终点。"
            : "两个终点的浓度并不相同。",
        charts: [
          chart(
            "不同最大降解和中点参数的剂量反应曲线",
            "药物浓度 log10（nM）",
            "蛋白下降（%）",
            [
              series(
                "相对基线的蛋白下降",
                samples(-2, 5).map((x) => [
                  x,
                  degradation(dmax, halfMax, 10 ** x),
                ]),
              ),
            ],
            [-2, 5],
          ),
        ],
      };
    },
  },
  "degradation-recovery": {
    validateData: (data) =>
      validateOverlays(data, "time", ["protein-time", "protein-washout"]),
    inputs: (data) =>
      overlayInputs(proximityInputs.Kinetics, data.overlays.time),
    run({ halfLife, kdeg, washout, overlay }, data) {
      const at = degradationLevel(halfLife, kdeg, washout, washout),
        after = degradationLevel(halfLife, kdeg, washout, washout + 24),
        needed = at < 95 ? halfLifeForRecovery(at, 95, 24) : null;
      const curves = [
        series(
          "模型：蛋白相对基线水平",
          degradationKinetics(halfLife, kdeg, washout),
        ),
      ];
      curves.push(...measuredOverlays(overlay, data, "time"));
      return {
        readouts: [
          readout("撤药时蛋白（%）", at),
          readout("撤药 24 h 后，模型给出（%）", after),
          readout(
            "24 h 内回到 95% 所需半衰期（h）",
            needed === null ? "—" : needed,
          ),
        ],
        charts: [
          chart(
            "给药与撤药后的蛋白数量变化",
            "时间（h）",
            "蛋白水平（%）",
            curves,
            [0, 72],
            [0, 110],
          ),
        ],
      };
    },
  },
  "ternary-selectivity": {
    inputs: proximityInputs.Selectivity,
    run({ tumor, normal, drug }) {
      const t = riptacDistribution(tumor, 10 ** drug),
        n = riptacDistribution(normal, 10 ** drug),
        percent = (v) => ((v / 50) * 100).toFixed(1) + "%";
      return {
        readouts: [
          readout("肿瘤背景模型：EP 进入三元", percent(t.ternary)),
          readout("正常背景模型：EP 进入三元", percent(n.ternary)),
          readout("肿瘤背景模型：EP 单端结合比例", percent(t.effectorBinary)),
          readout("正常背景模型：EP 单端结合比例", percent(n.effectorBinary)),
        ],
        summary: `同样的游离药物，不同的复合物分布。两模型的 EP 单端结合比例分别为 ${percent(t.effectorBinary)} 与 ${percent(n.effectorBinary)}。即使将正常背景 TP 调为 0，仍可出现 EP–药物二元结合。三元读数是复合物占 EP 的比例，细胞死亡百分比和正常组织的安全性要另外测。`,
      };
    },
  },
  "pkpd-turnover": {
    inputs: proximityInputs.PkPd,
    run({ pkHalfLife, unbound, pdHalfLife }) {
      const r = pkpd(pkHalfLife, unbound / 100, pdHalfLife);
      return {
        charts: [
          chart(
            "药物相对浓度与蛋白相对水平的教学模型",
            "时间（h）",
            "各自基线归一化（%）",
            [
              series("总药物浓度 / 初始总浓度", r.drugCurve),
              series("蛋白水平 / 初始蛋白水平", r.proteinCurve),
            ],
            [0, 48],
          ),
        ],
      };
    },
  },
};
