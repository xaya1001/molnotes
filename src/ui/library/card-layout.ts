import { layoutRoute } from "./route-layout.ts";

export const phoneCardWidth = 334;
export const chemicalCardWidths = [680, 814, phoneCardWidth];
export const cardInset = (phone: boolean) => (phone ? 26 : 34);
// At 390 px the reading column has 16 px page gutters and the card has its own inset.
export const phoneArtworkWidth = 390 - 2 * 16 - cardInset(true);
export const cardConditionFont = (scale: number) => `${12 / scale}px`;
type LayoutOptions = Parameters<typeof layoutRoute>[2];

export function chemicalCardLayout(
  steps: Parameters<typeof layoutRoute>[0],
  molecules: Parameters<typeof layoutRoute>[1],
  width: number,
  bond: number,
  text: (
    lines: string[],
    scale: number,
    maxWidth?: number,
  ) => ReturnType<LayoutOptions["text"]>,
  artworkWidth?: number,
) {
  const available = width - cardInset(width === phoneCardWidth);
  const place = (scale: number, vertical = false) =>
    layoutRoute(steps, molecules, {
      width: available / scale,
      bond,
      gap: 8 / scale,
      serpentine: true,
      text: (lines, maxWidth) => text(lines, scale, maxWidth),
      card: { scale, vertical, artworkWidth },
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
