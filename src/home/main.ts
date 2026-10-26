import { boot } from "../ui/api";
import { loadContent } from "../ui/content-data";
import { loadSiteRecords } from "../ui/site-records";
import { mountPage } from "@ui";
import App from "./App.vue";

boot(async () => {
  await loadContent();
  await loadSiteRecords();
  mountPage(App);
});
