import { defineConfig } from "golar/unstable";
import "@golar/vue";

export default defineConfig({
  typecheck: {
    include: [
      "src/**/*.{ts,vue}",
      "vite.config.ts",
      "playwright.config.ts",
      "golar.config.ts",
    ],
  },
});
