import { defineComponent, h } from "vue";
import { api, boot } from "../ui/api.ts";
import { mountPage } from "@ui";
import type { LibrarySnapshot } from "../../shared/chemical-library/types.ts";
import App from "./App.vue";
boot(async () => {
  const library = await api<LibrarySnapshot>("/api/library");
  mountPage(defineComponent({ setup: () => () => h(App, { library }) }));
});
