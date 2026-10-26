import { ref } from "vue";

/** The term card, source card or cited original currently open above the topic, if any. */
export const overlay = ref<
  | { kind: "term"; term: string }
  | { kind: "source"; id: number | string }
  | { kind: "citation"; href: string }
  | null
>(null);

export function openTerm(term: string) {
  overlay.value = { kind: "term", term };
}

export function openSource(id: number | string) {
  overlay.value = { kind: "source", id };
}

export function openCitation(href: string) {
  overlay.value = { kind: "citation", href };
}

export function closeOverlay() {
  overlay.value = null;
}
