import { chromium } from "@playwright/test";
export async function smokeBrowser(baseURL, topic, note) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    for (const path of ["/", topic, ...(note ? [note] : [])]) {
      const response = await page.goto(baseURL + path);
      if (!response?.ok()) throw new Error(`Smoke failed: ${path}`);
      await page
        .locator("h1")
        .first()
        .waitFor({ state: "visible", timeout: 30000 });
      if (await page.getByText("页面不存在", { exact: true }).count())
        throw new Error(`Smoke missing page: ${path}`);
    }
  } finally {
    await browser.close();
  }
}
if (process.argv[1] === import.meta.filename)
  await smokeBrowser(process.argv[2], process.argv[3], process.argv[4]);
