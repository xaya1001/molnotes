/** Authored pixel density; saved scene coordinates remain in bond units. */
export function chemicalFigureStyle(
  style: { values: Record<string, string> },
  density?: { bond?: number; width?: number },
) {
  if (!density) return style;
  const ratio =
    density.bond === undefined
      ? 1
      : density.bond / parseFloat(style.values["--chemical-bond"]);
  const values = Object.fromEntries(
    Object.entries(style.values).map(([key, value]) => [
      key,
      value.endsWith("px") &&
      !key.startsWith("--chemical-min-") &&
      key !== "--chemical-route-width"
        ? `${parseFloat(value) * ratio}px`
        : value,
    ]),
  );
  if (density.width !== undefined)
    values["--chemical-route-width"] = `${density.width}px`;
  return { values };
}
