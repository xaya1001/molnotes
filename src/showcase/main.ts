import { mountApp } from "@ui";
import App from "./App.vue";
import { routes } from "./pages.ts";

mountApp(App, { base: "/showcase/", routes });
