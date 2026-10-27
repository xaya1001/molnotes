import { expect, test } from "./helpers/test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { execFileSync } from "node:child_process";
import { publishSnapshot } from "./helpers/content-snapshot.mjs";
import { buildSnapshot } from "../scripts/content/content-publish.mjs";
import { writeSnapshot } from "../scripts/content/content-snapshot.mjs";
import { openRecords } from "../server/web/records.mjs";
import { createWebServer } from "../server/web/web.mjs";

test("generated chapters compose the shared shell and the block catalogue", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const root = resolve(import.meta.dirname, "..");
  const fixture = await mkdtemp(join(tmpdir(), "il-authoring-"));
  const records = openRecords(join(fixture, "records.sqlite"));
  const releases = join(fixture, "releases");
  const server = createWebServer({
    records,
    snapshot: join(releases, "current"),
  });
  try {
    const title = "专题 <chapter> {{ 7 * 7 }} </script>";
    execFileSync(
      process.execPath,
      [
        join(root, "scripts/new-site.mjs"),
        "authoring",
        title,
        "内容扩充验证",
        "靶点案例",
      ],
      { cwd: root, env: { ...process.env, MOLNOTES_CONTENT_DIR: fixture } },
    );
    const topic = join(fixture, "sites/authoring");
    const contentPath = join(topic, "content.json");
    const content = JSON.parse(await readFile(contentPath, "utf8"));
    content.chapters.push({
      id: "added",
      number: 2,
      title: "新增章节",
      short: "新增",
      minutes: 10,
      lead: "媒体与结构块",
      refs: [1],
      excerpts: [],
      reading: [],
      layout: "wide",
      blocks: [
        { type: "paragraph", text: "块里的正文 [1]" },
        {
          type: "figure",
          src: "/sites/authoring/static/figure.svg",
          alt: "中性图形",
          caption: "示例图",
        },
        { type: "list", items: ["第一点", "第二点"] },
      ],
    });
    await writeFile(contentPath, JSON.stringify(content));
    await mkdir(join(topic, "static"), { recursive: true });
    await writeFile(
      join(topic, "static/figure.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="80"><rect width="160" height="80" fill="teal"/></svg>',
    );
    await writeFile(join(fixture, "glossary.json"), "[]");
    await publishSnapshot(releases, async (snapshot) =>
      writeSnapshot(snapshot, await buildSnapshot(fixture)),
    );
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Preview TCP address is missing");
    await page.goto(`http://127.0.0.1:${address.port}/sites/authoring/intro`);
    await expect(
      page.locator('.sidebar-shelf a[href="/sites/authoring/"]'),
    ).toBeVisible();
    await expect(page).toHaveTitle(`开始学习 · ${title} · 分子笔记`);
    await expect(
      page.getByRole("heading", { level: 1, name: "开始学习" }),
    ).toBeVisible();
    await page.getByRole("link", { name: /下一节\s*新增章节/ }).click();
    await expect(page).toHaveURL(/\/sites\/authoring\/added$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "新增章节" }),
    ).toBeFocused();
    await expect(page.locator("article.page-wide")).toBeVisible();
    await expect(page.getByText("块里的正文", { exact: false })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "查看来源 1" }).first(),
    ).toBeVisible();
    await expect(page.locator("article .prose li")).toHaveCount(2);
    await page.getByRole("button", { name: "放大查看：示例图" }).click();
    const image = page.getByRole("dialog", { name: "示例图" }).locator("img");
    await expect.poll(() => image.evaluate((el) => el.naturalWidth)).toBe(160);
    await page.getByRole("button", { name: "关闭图片" }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "目录", exact: true }).click();
    await page
      .getByRole("dialog", { name: "专题目录" })
      .getByRole("link", { name: /开始学习$/ })
      .click();
    await expect(
      page.getByRole("heading", { level: 1, name: "开始学习" }),
    ).toBeFocused();
    await page.getByRole("link", { name: "分子笔记", exact: true }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "接着学" }),
    ).toBeVisible();
  } finally {
    await new Promise<void>((resolve, reject) => {
      if (!server) return resolve();
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    });
    records.close();
    await rm(fixture, { recursive: true, force: true });
  }
});
