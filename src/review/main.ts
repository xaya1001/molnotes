import { boot } from "../ui/api.ts";
import { loadContent } from "../ui/content-data.ts";
import { loadSiteRecords } from "../ui/site-records.ts";
import { mountPage } from "@ui";
import App from "./App.vue";

boot(async () => {
  await loadContent();
  await loadSiteRecords();
  mountPage(App);
});
