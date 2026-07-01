import { test, expect, Page } from "@playwright/test";

async function load(page: Page) {
  await page.addInitScript({ path: "tests/mocks/tauri-ipc.js" });
  await page.goto("/");
  await page.waitForSelector('[data-testid="tab"]');
}

function tabpos(page: Page) {
  return page.locator('[data-testid="app-root"]');
}

test.beforeEach(async ({ page }) => {
  await load(page);
});

test("default tab position is top", async ({ page }) => {
  await expect(tabpos(page)).toHaveAttribute("data-tabpos", "top");
  // No sidebar in top mode
  await expect(page.locator('[data-testid="sidebar"]')).toHaveCount(0);
});

test("settings-changed to left switches to a left sidebar and keeps tabs", async ({ page }) => {
  await page.evaluate(() =>
    window.__TEST_EMIT__("settings-changed", { tab_position: "left" })
  );

  await expect(tabpos(page)).toHaveAttribute("data-tabpos", "left");
  await expect(page.locator('[data-testid="sidebar"]')).toBeVisible();
  // Tabs still render and the editor still works
  await expect(page.locator('[data-testid="tab"]').first()).toBeVisible();
  await expect(page.locator('[data-testid="editor"]')).toBeVisible();
});

test("settings-changed to right switches to a right sidebar and keeps tabs", async ({ page }) => {
  await page.evaluate(() =>
    window.__TEST_EMIT__("settings-changed", { tab_position: "right" })
  );

  await expect(tabpos(page)).toHaveAttribute("data-tabpos", "right");
  await expect(page.locator('[data-testid="sidebar"]')).toBeVisible();
  await expect(page.locator('[data-testid="tab"]').first()).toBeVisible();
  await expect(page.locator('[data-testid="editor"]')).toBeVisible();
});

test("switching back to top removes the sidebar", async ({ page }) => {
  await page.evaluate(() =>
    window.__TEST_EMIT__("settings-changed", { tab_position: "left" })
  );
  await expect(tabpos(page)).toHaveAttribute("data-tabpos", "left");

  await page.evaluate(() =>
    window.__TEST_EMIT__("settings-changed", { tab_position: "top" })
  );
  await expect(tabpos(page)).toHaveAttribute("data-tabpos", "top");
  await expect(page.locator('[data-testid="sidebar"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="tab"]').first()).toBeVisible();
});

test("toolbar buttons remain usable in a sidebar orientation", async ({ page }) => {
  await page.evaluate(() =>
    window.__TEST_EMIT__("settings-changed", { tab_position: "left" })
  );
  await expect(page.locator('[data-testid="sidebar"]')).toBeVisible();
  // add-tab still works from the sidebar
  const before = await page.locator('[data-testid="tab"]').count();
  await page.locator('[data-testid="add-tab"]').click();
  await expect(page.locator('[data-testid="tab"]')).toHaveCount(before + 1);
});
