import { expect, type Page } from "@playwright/test";

interface ChapterContent {
  sources?: { id: string | number }[];
  chapters: {
    id: string;
    blocks: {
      type: string;
      text?: string;
      id?: string;
      explanation?: string;
      kind?: string;
      options?: string[];
      answer?: unknown;
    }[];
  }[];
}

/** The text a paragraph shows when `[5,7]` becomes source buttons: the numbers stand where the brackets were. */
const shown = (text: string, content: ChapterContent) =>
  text.replace(/\[([1-9]\d*(?:,[1-9]\d*)*)\]/g, (match, ids: string) =>
    !content.sources ||
    ids
      .split(",")
      .every((id) =>
        content.sources!.some((source) => source.id === Number(id)),
      )
      ? ids.split(",").join("")
      : match,
  );

/** A paragraph as written, or as shown with source buttons. */
const paragraphOn = (page: Page, paragraph: string, content: ChapterContent) =>
  page
    .getByText(paragraph, { exact: true })
    .or(page.getByText(shown(paragraph, content), { exact: true }));

/** All chapter headings and paragraphs are readable independently of predictions. */
export function chapterTexts(content: ChapterContent, chapterId: string) {
  const chapter = content.chapters.find((item) => item.id === chapterId);
  if (!chapter) throw new Error(`Unknown chapter: ${chapterId}`);
  const texts = {
    titles: chapter.blocks
      .filter((block) => block.type === "heading")
      .map((block) => block.text!),
    paragraphs: chapter.blocks
      .filter((block) => block.type === "paragraph")
      .map((block) => block.text!),
  };
  return texts;
}

/** Before predicting, prose is visible and the prediction result is absent. */
export async function expectBeforePrediction(
  page: Page,
  content: ChapterContent,
  chapterId: string,
) {
  const { titles, paragraphs } = chapterTexts(content, chapterId);
  const predictions = content.chapters
    .find((chapter) => chapter.id === chapterId)!
    .blocks.filter((block) => block.type === "prediction");
  for (const prediction of predictions) {
    const exercise = page.getByTestId(
      `prediction-${prediction.id ?? chapterId}`,
    );
    await expect(exercise).toHaveAttribute("aria-label", "先预测再揭晓");
    await expect(
      exercise.getByText(prediction.explanation!, { exact: true }),
    ).toHaveCount(0);
    await expect(exercise.getByText(/^正确答案：/)).toHaveCount(0);
  }
  await expect(page.getByRole("region", { name: "预测结果" })).toHaveCount(0);
  for (const title of titles)
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
  for (const paragraph of paragraphs)
    await expect(paragraphOn(page, paragraph, content)).toBeVisible();
}

/** After predicting, prose remains visible alongside the result. */
export async function expectAfterPrediction(
  page: Page,
  content: ChapterContent,
  chapterId: string,
) {
  const { titles, paragraphs } = chapterTexts(content, chapterId);
  const prediction = content.chapters
    .find((chapter) => chapter.id === chapterId)!
    .blocks.find((block) => block.type === "prediction")!;
  const result = page.getByTestId(`prediction-${prediction.id ?? chapterId}`);
  await expect(result).toHaveAttribute("aria-label", "预测结果");
  await expect(result).toContainText(prediction.explanation!);
  if (
    (!prediction.kind || prediction.kind === "choice") &&
    typeof prediction.answer === "number"
  )
    await expect(result).toContainText(
      `正确答案：${prediction.options![prediction.answer]}`,
    );
  for (const title of titles) {
    const heading = page.getByRole("heading", { name: title, exact: true });
    await expect(heading).toBeVisible();
  }
  for (const paragraph of paragraphs)
    await expect(paragraphOn(page, paragraph, content)).toBeVisible();
}
