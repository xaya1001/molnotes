import { expect, test } from "@playwright/test";
import { figureBrowser } from "../scripts/figure-browser.ts";

test("table text applies shared chemical typography and retains emphasis and quantities", async () => {
  const browser = await figureBrowser({}, process.cwd());
  try {
    await browser.page.evaluate(async () => {
      const vue = "/node_modules/vue/dist/vue.runtime.esm-bundler.js";
      const table = "/src/ui/topic/TableText.vue";
      const { createApp, h } = await import(vue);
      const { default: TableText } = await import(table);
      createApp(TableText, {
        text: "**CH3**\ntert-BuOH cis-C2H4 R-CH3 H_{2}O SO4^{2-} C\\11 ≥ 95%; 25 °C",
      }).mount("#canvas");
      const metrics = document.createElement("div");
      document.body.append(metrics);
      createApp({
        render: () =>
          h("table", { id: "line-metrics" }, [
            h("tbody", [
              h("tr", [h("td", "CH₂")]),
              h("tr", [h("td", [h(TableText, { text: "CH2" })])]),
              h("tr", [h("td", "SO4^{2-}")]),
              h("tr", [h("td", [h(TableText, { text: "SO4^{2-}" })])]),
            ]),
          ]),
      }).mount(metrics);
    });
    const canvas = browser.page.locator("#canvas");
    await expect(canvas.locator("sub")).toHaveCount(6);
    await expect(canvas.locator("sup")).toHaveCount(1);
    await expect(canvas.locator("em")).toHaveCount(3);
    await expect(canvas.locator("strong sub")).toHaveCount(1);
    await expect(canvas.locator("br")).toHaveCount(1);
    await expect(canvas.locator(".quantity")).toHaveCount(2);
    for (const quantity of await canvas.locator(".quantity").all())
      await expect(quantity).toHaveCSS("white-space", "nowrap");
    expect(await canvas.innerText()).toContain("C11 ≥");
    const heights = await browser.page
      .locator("#line-metrics tr")
      .evaluateAll((rows) =>
        rows.map((row) => row.getBoundingClientRect().height),
      );
    expect(heights[1]).toBeCloseTo(heights[0], 1);
    expect(heights[3]).toBeCloseTo(heights[2], 1);
  } finally {
    await browser.close();
  }
});
