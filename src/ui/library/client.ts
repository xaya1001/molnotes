import { computed, watch, ref } from "vue";
import { api } from "../api.ts";
import type {
  FigureReference,
  LibrarySnapshot,
} from "../../../shared/chemical-library/types.ts";

let pending: Promise<LibrarySnapshot> | undefined;
export function loadLibrary() {
  return (pending ??= api<LibrarySnapshot>("/api/library").catch((error) => {
    pending = undefined;
    throw error;
  }));
}

/** Resolve saved image identity without changing the caller's image layout. */
export function useLibraryImage(
  input: () => string | FigureReference | undefined,
) {
  const library = ref<LibrarySnapshot>();
  const error = ref("");
  watch(
    input,
    async () => {
      if (typeof input() !== "object") return;
      try {
        library.value = await loadLibrary();
      } catch (e) {
        error.value = e instanceof Error ? e.message : String(e);
      }
    },
    { immediate: true },
  );
  const image = computed(() => {
    const value = input();
    if (typeof value === "string") return { src: value, alt: "" };
    if (!value || !library.value) return { src: "", alt: "" };
    const entry = library.value.entries[value.ref];
    if (entry?.kind !== "image")
      throw new Error(`Expected image: ${value.ref}`);
    return {
      src: `/library/assets/${entry.asset}`,
      alt: value.alt ?? entry.alt,
    };
  });
  return { image, error };
}
