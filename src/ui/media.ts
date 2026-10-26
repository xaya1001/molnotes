import { onBeforeUnmount, ref } from "vue";

/** Reactive `matchMedia` result, kept current until the owning component unmounts. */
export function useMediaQuery(query: string) {
  const list = window.matchMedia(query);
  const matches = ref(list.matches);
  const update = () => (matches.value = list.matches);
  list.addEventListener("change", update);
  onBeforeUnmount(() => list.removeEventListener("change", update));
  return matches;
}
