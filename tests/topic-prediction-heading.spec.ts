import { expect, test } from "@playwright/test";

for (const adjacent of [true, false]) {
  test(`prediction heading respects adjacent author heading: ${adjacent}`, async ({
    page,
  }) => {
    await page.route("**/api/topics/sample", async (route) => {
      const response = await route.fetch();
      const topic = await response.json();
      const prediction = topic.content.chapters[0].blocks.find(
        (block: { type: string }) => block.type === "prediction",
      );
      topic.content.chapters[0].blocks = [
        { type: "heading", text: "样本比较" },
        ...(!adjacent ? [{ type: "paragraph", text: "观察两个样本。" }] : []),
        prediction,
      ];
      topic.content.chapters[0].excerpts = [];
      topic.content.quiz = [];
      await route.fulfill({ response, json: topic });
    });
    await page.goto("/practice/sample/start");
    const prose = page.locator("article .prose");
    await expect(prose.locator(":scope > h2")).toHaveCount(adjacent ? 1 : 2);
    await expect(
      prose.locator(":scope > h2 + [data-testid=prediction-start]"),
    ).toHaveCount(1);
    if (!adjacent)
      await expect(
        prose.locator(":scope > h2 + p + h2 + [data-testid=prediction-start]"),
      ).toHaveCount(1);
  });
}
