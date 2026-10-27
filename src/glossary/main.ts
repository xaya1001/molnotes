import { defineComponent, h } from "vue";
import { api, boot } from "../ui/api.ts";
import { mountPage } from "@ui";
import type { GlossaryEntry } from "../../shared/glossary.ts";
import App from "./App.vue";

boot(async () => {
  const entries = await api<GlossaryEntry[]>("/api/glossary");
  mountPage(defineComponent({ setup: () => () => h(App, { entries }) }));
});
