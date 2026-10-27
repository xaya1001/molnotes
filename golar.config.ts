import { defineConfig } from "golar/unstable";
import "@golar/vue";

export default defineConfig({
  typecheck: {
    include: [
      "src/**/*.{ts,vue}",
      "shared/**/*.ts",
      "vite.config.ts",
      "playwright.config.ts",
      "golar.config.ts",
    ],
  },
});
