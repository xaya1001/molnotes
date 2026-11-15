import { isObject, fail } from "./model.ts";

export type EnergyPoint = { e: number; text: string };
export type EnergyPath = {
  name?: string;
  focus: boolean;
  rds?: string;
  points: EnergyPoint[];
};
export type EnergyRef = { path: number; index: number };
export type EnergyMark = { from: EnergyRef; to: EnergyRef; text: string };
export type Energy = {
  axis: string;
  unit: "kJ/mol" | "kcal/mol";
  scale: boolean;
  paths: EnergyPath[];
  marks: EnergyMark[];
};

function fields(value: unknown, names: string[]) {
  if (!isObject(value)) fail("energy 需要 YAML 对象");
  for (const key of Object.keys(value))
    if (!names.includes(key)) fail(`energy 不认识字段 “${key}”`);
  return value;
}
function text(value: unknown, max: number, message: string): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    [...value.trim()].length > max
  )
    fail(message);
  return value.trim();
}
function flag(value: unknown, field: string) {
  if (value !== undefined && typeof value !== "boolean")
    fail(`${field} 需要 true 或 false`);
  return value === true;
}
function points(value: unknown, name: string): EnergyPoint[] {
  if (!Array.isArray(value)) fail(`路径 “${name}” 的 points 需要点列表`);
  if (value.length < 3 || value.length % 2 !== 1)
    fail(
      `路径 “${name}” 有 ${value.length} 个点；应为奇数：极小点、过渡态交替，首尾是极小点`,
    );
  const seen = new Set<string>();
  const result = value.map((item, i) => {
    const match =
      typeof item === "string" &&
      /^([+\-−]?(?:\d+(?:\.\d*)?|\.\d+))\s+(.*)$/u.exec(item.trimStart());
    if (!match || !Number.isFinite(Number(match[1].replace("−", "-"))))
      fail(`第 ${i + 1} 个点应写成“能量 标签”，如 “90 TS1”`);
    const label = text(match[2], 20, `第 ${i + 1} 个点的标签需要 1–20 个字`);
    if (seen.has(label)) fail(`路径 “${name}” 里 “${label}” 出现了两次`);
    seen.add(label);
    return { e: Number(match[1].replace("−", "-")), text: label };
  });
  for (let i = 1; i < result.length; i += 2) {
    const [a, b, c] = result.slice(i - 1, i + 2);
    if (b.e <= a.e || b.e <= c.e)
      fail(
        `“${b.text}”（${b.e}）应高于两侧的 “${a.text}”（${a.e}）和 “${c.text}”（${c.e}）`,
      );
  }
  return result;
}

/** Validate an authored fence and resolve its references before rendering. */
export function defineEnergy(value: unknown): Energy {
  const input = fields(value, [
    "points",
    "paths",
    "rds",
    "marks",
    "scale",
    "unit",
    "axis",
    "name",
    "focus",
  ]);
  if ((input.points === undefined) === (input.paths === undefined))
    fail("energy 需要 points 或 paths 其中一个");
  if (
    input.name !== undefined ||
    input.focus !== undefined ||
    (input.paths !== undefined && input.rds !== undefined)
  )
    fail("rds 写在对应路径下");
  const paths: EnergyPath[] = [];
  const addPath = (item: Record<string, unknown>, name?: string) => {
    const ps = points(item.points, name ?? "单路径");
    const rds = item.rds;
    if (
      rds !== undefined &&
      (typeof rds !== "string" ||
        !ps.some((p, i) => i % 2 === 1 && p.text === rds))
    )
      fail(`rds “${String(rds)}” 不是路径 “${name ?? "单路径"}” 的过渡态`);
    paths.push({
      ...(name ? { name } : {}),
      points: ps,
      focus: flag(item.focus, "focus"),
      ...(rds === undefined ? {} : { rds: String(rds) }),
    });
  };
  if (input.paths === undefined) addPath(input);
  else {
    if (
      !Array.isArray(input.paths) ||
      input.paths.length < 2 ||
      input.paths.length > 3
    )
      fail("paths 需要 2–3 条路径；单条路径请直接写 points");
    for (const value of input.paths) {
      const item = fields(value, ["name", "points", "focus", "rds"]);
      const name = text(item.name, 16, "每条路径需要不重复的 name");
      if (paths.some((p) => p.name === name)) fail("每条路径需要不重复的 name");
      addPath(item, name);
    }
  }
  if (paths.filter((p) => p.focus).length > 1) fail("只能有一条路径 focus");
  for (let i = 0; i < paths.length; i++)
    for (let j = 0; j < i; j++)
      if (JSON.stringify(paths[i].points) === JSON.stringify(paths[j].points))
        fail(`路径 “${paths[i].name}” 与 “${paths[j].name}” 完全相同`);
  const resolve = (label: unknown, path: unknown): EnergyRef => {
    if (path !== undefined && !paths.some((p) => p.name === path))
      fail(`标注里的路径 “${String(path)}” 不存在`);
    const refs = paths.flatMap((p, k) =>
      p.points.flatMap((point, i) =>
        point.text === label && (path === undefined || p.name === path)
          ? [{ path: k, index: i }]
          : [],
      ),
    );
    if (!refs.length) fail(`标注里的 “${String(label)}” 没有对应的点`);
    const first = refs[0];
    const a = paths[first.path].points[first.index];
    if (
      refs.some(
        (r) =>
          paths[r.path].points[r.index].e !== a.e ||
          r.index / (paths[r.path].points.length - 1) !==
            first.index / (paths[first.path].points.length - 1),
      )
    )
      fail(`“${String(label)}” 在多条路径里位置不同，请加 path`);
    return first;
  };
  const markItems = input.marks ?? [];
  if (!Array.isArray(markItems)) fail("marks 需要标注列表");
  if (markItems.length > 3) fail("一张图最多 3 个标注");
  const marks = markItems.map((value): EnergyMark => {
    const item = fields(value, ["from", "to", "text", "path"]);
    const from = resolve(item.from, item.path),
      to = resolve(item.to, item.path);
    if (from.path === to.path && from.index === to.index)
      fail("标注的起点和终点相同");
    let label = item.text;
    if (label === undefined) {
      if (from.index % 2 !== 0)
        fail(
          `从 “${String(item.from)}” 到 “${String(item.to)}” 的标注需要 text`,
        );
      label = to.index % 2 === 1 ? "ΔG‡" : "ΔG°";
    }
    return { from, to, text: text(label, 10, "标注 text 需要 1–10 个字") };
  });
  const unit = input.unit ?? "kJ/mol";
  if (unit !== "kJ/mol" && unit !== "kcal/mol")
    fail("unit 只能是 kJ/mol 或 kcal/mol");
  return {
    paths,
    marks,
    scale: flag(input.scale, "scale"),
    unit,
    axis:
      input.axis === undefined
        ? "能量"
        : text(input.axis, 8, "axis 需要 1–8 个字"),
  };
}

export function energyText(energy: Energy): string[] {
  return [
    energy.axis,
    ...energy.paths.flatMap((p) => [
      p.name ?? "",
      ...p.points.map((point) => point.text),
    ]),
    ...energy.marks.map((m) => m.text),
  ];
}
export const energyNumber = (value: number) => String(value).replace("-", "−");
