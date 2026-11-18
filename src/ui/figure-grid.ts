import { computed, type Ref } from "vue";

export function figureGrid(
  count: number,
  widest: number,
  width: number,
  pad: number,
  minimumScale: number,
) {
  const gap = 12;
  const minimum = 200;
  let columns = Math.max(
    1,
    Math.min(count, Math.floor((width + gap) / (minimum + gap))),
  );
  const track = (k: number) => (width - (k - 1) * gap) / k;
  const fit = (k: number) => Math.min(1, (track(k) - 2 * pad) / widest);
  while (columns > 1 && fit(columns) < minimumScale) columns--;
  columns = Math.max(1, Math.ceil(count / Math.ceil(count / columns)));
  const scale = Math.max(minimumScale, fit(columns));
  const columnWidth =
    columns > 1
      ? track(columns)
      : Math.min(width, Math.max(minimum, widest * scale + 2 * pad));
  return { columns, columnWidth, scale };
}

export function useFigureGrid(
  widths: Ref<{ reading: number; wide: number; desktop: boolean }>,
  measures: () => readonly number[],
  minimumScale: () => number,
) {
  return computed(() => {
    const { reading, wide, desktop } = widths.value;
    const items = measures();
    const widest = Math.max(1, ...items);
    const plan = (width: number) =>
      figureGrid(
        items.length,
        widest,
        width,
        desktop ? 17 : 13,
        minimumScale(),
      );
    const normal = plan(reading);
    const expanded = plan(wide);
    const useWide =
      desktop &&
      wide > reading &&
      (expanded.columns > normal.columns ||
        (expanded.columns === normal.columns &&
          (expanded.scale > normal.scale ||
            widest * normal.scale + 34 > normal.columnWidth)));
    const chosen = useWide ? expanded : normal;
    return {
      ...chosen,
      style: {
        "--figure-grid-width": useWide ? `${wide}px` : undefined,
        gridTemplateColumns: `repeat(${chosen.columns}, ${chosen.columnWidth}px)`,
      },
    };
  });
}
