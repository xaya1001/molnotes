import { defineComponent, h } from "vue";
import { api, boot } from "../ui/api";
import { mountPage } from "@ui";
import type { GlossaryEntry } from "../../scripts/glossary.mjs";
import App from "./App.vue";

boot(async () => {
  const entries = await api<GlossaryEntry[]>("/api/glossary");
  mountPage(defineComponent({ setup: () => () => h(App, { entries }) }));
});
