import type { Measurement, Assay } from "./patent";
export function measurementText(m: Measurement, assay: Assay) {
  if (m.status !== "reported")
    return `${m.status === "not-tested" ? "未测定" : m.status === "unresolved" ? "待核实" : "未报告"} · ${m.reason}`;
  return `${m.qualifier === "range" ? `${m.value}–${m.upper}` : `${m.qualifier === "=" ? "" : m.qualifier}${m.value}`} ${assay.unit ?? "单位待核实"}`;
}
/** A bound accepts only observations whose entire possible interval satisfies it. */
export function measurementWithin(m: Measurement, min: string, max: string) {
  if (m.status !== "reported") return false;
  const low = ["<", "<="].includes(m.qualifier) ? -Infinity : m.value;
  const high = [">", ">="].includes(m.qualifier)
    ? Infinity
    : m.qualifier === "range"
      ? m.upper!
      : m.value;
  return (
    (!min || (Number.isFinite(Number(min)) && low >= Number(min))) &&
    (!max || (Number.isFinite(Number(max)) && high <= Number(max)))
  );
}
