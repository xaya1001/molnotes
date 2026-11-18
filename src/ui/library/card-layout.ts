import { layoutRoute } from "./route-layout.ts";

export const chemicalCardWidths = [680, 814, 334];
export const cardConditionFont = (scale: number) => `${12 / scale}px`;
type LayoutOptions = Parameters<typeof layoutRoute>[2];

export function chemicalCardLayout(
  steps: Parameters<typeof layoutRoute>[0],
  molecules: Parameters<typeof layoutRoute>[1],
  width: number,
  bond: number,
  text: (lines: string[], scale: number) => ReturnType<LayoutOptions["text"]>,
) {
  const phone = width === 334;
  const available = width - (phone ? 26 : 34);
  const place = (scale: number, vertical = false) =>
    layoutRoute(steps, molecules, {
      width: available / scale,
      bond,
      gap: 8 / scale,
      serpentine: true,
      text: (lines) => text(lines, scale),
      card: { scale, vertical },
    });
  const scales = [28, 25.2, 22.4, 20].map((length) => length / bond);
  const candidates = scales.map((scale) => ({ scale, layout: place(scale) }));
  const horizontal = candidates
    .filter(
      ({ layout, scale }) =>
        !layout.singleton && layout.width * scale <= available + 1,
    )
    .sort((a, b) => a.layout.rows - b.layout.rows || b.scale - a.scale)[0];
  if (horizontal) return horizontal;
  const widest = Math.max(
    ...Object.values(molecules).map(({ width }) => width),
  );
  const scale = Math.max(
    scales.at(-1)!,
    Math.min(scales[0], available / widest),
  );
  return { scale, layout: place(scale, true) };
}
