import { mountApp } from "@ui";
import App from "./App.vue";
import { routes } from "./pages";

mountApp(App, { base: "/showcase/", routes });
