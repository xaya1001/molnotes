import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { test, expect } from "./helpers/test.ts";
import { putRecords } from "./helpers/records.ts";

for (const width of [1366, 390]) {
  test(`Markdown exercises use shared answers and records at ${width}`, async ({
    page,
  }) => {
    await putRecords(page.request, "/api/records/topics/sample", {
      data: {
        version: 1,
        complete: [],
        bookmarks: [],
        notes: {},
        answers: {},
        diagnostic: {},
        predictions: {},
        problems: {},
      },
    });
    await page.setViewportSize({ width, height: width === 1366 ? 900 : 844 });
    await page.emulateMedia({ colorScheme: "light" });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const screenshot = async (view: string) => {
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      if (!process.env.PRACTICE_SCREENS) return;
      const folder = join(process.env.TMPDIR!, "screens");
      await mkdir(folder, { recursive: true });
      await page.evaluate(() =>
        window.scrollTo({ top: 0, behavior: "instant" }),
      );
      await page.screenshot({
        path: join(folder, `${view}-${width}.png`),
        fullPage: true,
        animations: "disabled",
      });
    };
    await page.goto("/notes/reader-test/second");
    const link = page.locator('a[href="/practice/sample/written"]');
    await expect(link).toBeVisible();
    await screenshot("note");
    await link.click();
    await expect(
      page.locator('article a[href="/notes/reader-test/second"]'),
    ).toBeVisible();
    const choice = page.getByTestId("prediction-written-choice");
    const open = page.getByTestId("problem-written-open");
    const atom = page.getByTestId("prediction-written-atom");
    await expect(
      atom.getByRole("button", { name: "原子 2", exact: true }),
    ).toBeVisible();
    await screenshot("markdown");
    await choice.getByRole("radio", { name: "B", exact: true }).check();
    await choice.getByRole("button", { name: "提交预测" }).click();
    await open.getByRole("textbox").fill("A 比 B 多一个。");
    await open.getByRole("button").first().click();
    await open.getByRole("group").getByRole("button").nth(1).click();
    await atom.getByRole("button", { name: "原子 2", exact: true }).click();
    await atom.getByRole("button", { name: "提交预测" }).click();
    await expect
      .poll(async () => {
        const records = await (
          await page.request.get("/api/records/topics/sample")
        ).json();
        return {
          choice: records.predictions["written-choice"],
          atom: records.predictions["written-atom"],
          open: records.problems["written-open"],
        };
      })
      .toEqual({
        choice: { option: 1 },
        atom: { selected: [2] },
        open: { response: "A 比 B 多一个。", rating: "unknown" },
      });
    await screenshot("answered");
    await page.reload();
    await expect(choice.getByRole("radio")).toHaveCount(0);
    await expect(atom.getByRole("button")).toHaveCount(0);
    await expect(open.getByRole("textbox")).toHaveValue("A 比 B 多一个。");
    await page.goto("/review/");
    await expect(
      page.getByTestId("mistake-prediction-written-choice"),
    ).toBeVisible();
    await expect(
      page.getByTestId("mistake-problem-written-open"),
    ).toBeVisible();
    await page.goto("/practice/sample/written");
    await choice.getByRole("button", { name: "重新判断" }).click();
    await choice.getByRole("radio", { name: "A", exact: true }).check();
    await choice.getByRole("button", { name: "提交预测" }).click();
    await open.getByRole("button").first().click();
    await open.getByRole("group").getByRole("button").first().click();
    await expect
      .poll(async () => {
        const records = await (
          await page.request.get("/api/records/topics/sample")
        ).json();
        return [
          records.predictions["written-choice"]?.option,
          records.problems["written-open"]?.rating,
        ];
      })
      .toEqual([0, "know"]);
    await page.goto("/review/");
    await expect(
      page.getByTestId("mistake-prediction-written-choice"),
    ).toHaveCount(0);
    await expect(page.getByTestId("mistake-problem-written-open")).toHaveCount(
      0,
    );
    await page.goto("/practice/sample/next");
    await expect(
      page.getByTestId("problem-compare-zh").getByRole("textbox"),
    ).toBeVisible();
    await screenshot("json");
    expect(errors).toEqual([]);
  });
}
