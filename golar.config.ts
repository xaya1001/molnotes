import { defineConfig } from "golar/unstable";
import "@golar/vue";

export default defineConfig({
  typecheck: {
    include: [
      "src/**/*.{ts,vue}",
      "shared/**/*.ts",
      "server/**/*.ts",
      "scripts/**/*.ts",
      "tests/**/*.ts",
      "toolbox/**/*.ts",
      "*.ts",
    ],
    // The video composition needs React's JSX types, which the project does not install.
    exclude: ["toolbox/video/**", "tests/fixtures/**"],
  },
});
