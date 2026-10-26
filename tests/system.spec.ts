import { expect, test } from "@playwright/test";

test("the system page shows the running version and starts an available update", async ({
  page,
}) => {
  const running = "fe56f19a39d280a75fba979d9464f8de3284deea";
  const latest = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  let started = false;

  await page.route("**/system/api/status", async (route) => {
    await route.fulfill({
      status: 200,
      json: {
        running: {
          revision: running,
          image: "sha256:current",
          health: "healthy",
        },
        latest: { revision: latest, check: "passed" },
        update: {
          state: started ? "running" : "idle",
          target: started ? latest : null,
        },
        canUpdate: !started,
      },
    });
  });
  await page.route("**/system/api/update", async (route) => {
    expect(route.request().method()).toBe("POST");
    started = true;
    await route.fulfill({ status: 202, json: { target: latest } });
  });

  await page.goto("/system/");
  await expect(page.getByRole("heading", { name: "系统信息" })).toBeVisible();
  await expect(page.getByText(running.slice(0, 7))).toBeVisible();
  await expect(page.getByText("有可用更新")).toBeVisible();
  await page.getByRole("button", { name: "更新网站" }).click();
  await expect(page.getByText("正在更新网站")).toBeVisible();
  await expect(page.getByRole("button", { name: "更新网站" })).toBeDisabled();
});

test("the system page reports an unreadable status response", async ({
  page,
}) => {
  await page.route("**/system/api/status", (route) =>
    route.fulfill({ status: 200, body: "<!doctype html>" }),
  );
  await page.goto("/system/");
  await expect(page.getByRole("alert")).toHaveText("系统信息暂时无法获取");
  await expect(page.getByRole("button", { name: "更新网站" })).toBeDisabled();
});
