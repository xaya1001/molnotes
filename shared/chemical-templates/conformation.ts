import { isObject } from "../json.ts";

export type SlotText = string | { t: string; color?: string };
/** Text slots describe a drawing, without asserting a molecular graph. */
export interface ConformationSpec {
  template: string;
  subs?: Record<string, SlotText>;
  atoms?: Record<string, string>;
  bonds?: Record<
    string,
    "plain" | "double" | "partial" | "dashed" | "bold" | "wedge" | "none"
  >;
  flip?: boolean;
  mirror?: boolean;
  rot?: number;
  scale?: number;
  sub_len?: number;
  slots?: boolean;
  clash?: [string, string][];
  front?: SlotText[];
  back?: SlotText[];
  dihedral?: number;
  rows?: [SlotText, SlotText][];
  top?: SlotText;
  bottom?: SlotText;
  bracket?: boolean | "ts";
}
export interface ConformationData {
  id: string;
  scale: number;
  subLength: number;
  reface: boolean;
  atoms: Record<string, string>;
  bonds: {
    atoms: [number, number];
    style: NonNullable<ConformationSpec["bonds"]>[string];
  }[];
  variants: Record<
    "normal" | "flipped",
    {
      points: Record<string, [number, number]>;
      slots: Record<string, { atom: number; direction: [number, number] }>;
    }
  >;
}
export function validateConformationSpec(
  value: unknown,
  where: string,
  extra: string[] = [],
): asserts value is ConformationSpec {
  const fail = (field: string): never => {
    throw new Error(`${where}.${field}: invalid conformation field`);
  };
  if (!isObject(value)) fail("template");
  const finite = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  const text = (v: unknown): boolean =>
    typeof v === "string" ||
    (isObject(v) &&
      typeof v.t === "string" &&
      (v.color === undefined || typeof v.color === "string") &&
      Object.keys(v).every((k) => k === "t" || k === "color"));
  const rules: Record<string, (v: unknown) => boolean> = {
    template: (v) => typeof v === "string" && /^[a-z][a-z0-9-]*$/.test(v),
    subs: (v) => isObject(v) && Object.values(v).every(text),
    atoms: (v) =>
      isObject(v) &&
      Object.entries(v).every(
        ([k, t]) => /^\d+$/.test(k) && typeof t === "string",
      ),
    bonds: (v) =>
      isObject(v) &&
      Object.entries(v).every(
        ([k, t]) =>
          /^\d+-\d+$/.test(k) &&
          [
            "plain",
            "double",
            "partial",
            "dashed",
            "bold",
            "wedge",
            "none",
          ].includes(String(t)),
      ),
    flip: (v) => typeof v === "boolean",
    mirror: (v) => typeof v === "boolean",
    slots: (v) => typeof v === "boolean",
    rot: finite,
    dihedral: finite,
    scale: (v) => finite(v) && Number(v) > 0,
    sub_len: (v) => finite(v) && Number(v) > 0,
    front: (v) => Array.isArray(v) && v.length === 3 && v.every(text),
    back: (v) => Array.isArray(v) && v.length === 3 && v.every(text),
    rows: (v) =>
      Array.isArray(v) &&
      v.length > 0 &&
      v.every((r) => Array.isArray(r) && r.length === 2 && r.every(text)),
    top: text,
    bottom: text,
    bracket: (v) => typeof v === "boolean" || v === "ts",
    clash: (v) =>
      Array.isArray(v) &&
      v.every(
        (r) =>
          Array.isArray(r) &&
          r.length === 2 &&
          r.every((t) => typeof t === "string"),
      ),
  };
  if (value.template === undefined) fail("template");
  for (const [k, v] of Object.entries(value)) {
    if (extra.includes(k)) continue;
    if (!rules[k]?.(v)) fail(k);
  }
}
