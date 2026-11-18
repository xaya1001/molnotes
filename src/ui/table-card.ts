import type { Directive } from "vue";
import { figureWidths } from "./figure-width.ts";

export function observeTableCard(card: HTMLElement) {
  const table = card.querySelector("table")!;
  const scroll = table.parentElement!;
  const parent = card.parentElement!;
  const main = card.closest("main");
  let frame = 0;
  function updateFade() {
    card.toggleAttribute(
      "data-more-columns",
      scroll.scrollLeft + scroll.clientWidth < scroll.scrollWidth - 1,
    );
  }
  function measure() {
    const { wide, desktop } = figureWidths(parent);
    card.style.removeProperty("--figure-width");
    card.classList.remove("figure-card--compact", "figure-card--scrolling");
    const overflowing = () => table.scrollWidth > scroll.clientWidth + 1;
    if (desktop && overflowing()) {
      card.style.setProperty("--figure-width", `${wide}px`);
      if (overflowing()) card.classList.add("figure-card--compact");
    }
    card.classList.toggle("figure-card--scrolling", overflowing());
    card.toggleAttribute("data-table-overflow", desktop && overflowing());
    updateFade();
  }
  const observer = new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(measure);
  });
  scroll.addEventListener("scroll", updateFade, { passive: true });
  observer.observe(parent);
  observer.observe(table);
  if (main) observer.observe(main);
  measure();
  return () => {
    scroll.removeEventListener("scroll", updateFade);
    observer.disconnect();
    cancelAnimationFrame(frame);
  };
}

const cleanups = new WeakMap<HTMLElement, () => void>();
export const vTableCard: Directive<HTMLElement> = {
  mounted: (card) => cleanups.set(card, observeTableCard(card)),
  unmounted: (card) => cleanups.get(card)?.(),
};

export function numericCell(value: string) {
  return /^[<>≤≥~≈]?\s*[+−-]?(?:\d[\d.,]*|\.\d+)(?:\s*(?:±|–|to)\s*[+−-]?\d[\d.,]*)?(?:\s*[%°\p{L}/^²³μµ·−¹⁻-]+)?$/u.test(
    value.trim(),
  );
}
