import { onMounted, onUnmounted, ref, type Ref } from "vue";

export function figureWidths(element: HTMLElement) {
  const reading = element.clientWidth;
  const main = element.closest("main");
  const desktop = matchMedia("(min-width: 641px)").matches;
  const style = main && getComputedStyle(main);
  const rootFont = parseFloat(
    getComputedStyle(document.documentElement).fontSize,
  );
  const width =
    main && style && desktop
      ? Math.min(
          main.clientWidth -
            parseFloat(style.paddingLeft) -
            parseFloat(style.paddingRight),
          document.documentElement.clientWidth - 2 * rootFont,
        )
      : reading;
  return { reading, wide: Math.max(reading, width), desktop };
}

export function useFigureWidths(element: Ref<HTMLElement | undefined>) {
  const widths = ref({ reading: 0, wide: 0, desktop: false });
  let observer: ResizeObserver | undefined;
  onMounted(() => {
    const target = element.value!;
    const update = () => (widths.value = figureWidths(target));
    observer = new ResizeObserver(update);
    observer.observe(target);
    const main = target.closest("main");
    if (main) observer.observe(main);
    update();
  });
  onUnmounted(() => observer?.disconnect());
  return widths;
}
