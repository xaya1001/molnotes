import { ref } from "vue";

/** Current short confirmation shown by the site bar, or "" when hidden. */
export const toastMessage = ref("");
let timer: ReturnType<typeof setTimeout> | undefined;

export function showToast(message: string, duration = 3400) {
  clearTimeout(timer);
  toastMessage.value = message;
  timer = setTimeout(() => (toastMessage.value = ""), duration);
}

/** Starts a browser download of generated text. */
export function downloadFile(content: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}
