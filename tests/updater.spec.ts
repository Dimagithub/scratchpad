import { test, expect, Page } from "@playwright/test";

async function load(page: Page) {
  await page.addInitScript({ path: "tests/mocks/tauri-ipc.js" });
  await page.goto("/");
  await page.waitForSelector('[data-testid="tab"]');
  // Wait for React effects to register all event listeners (listen() calls are async)
  await page.waitForTimeout(100);
}

test.beforeEach(async ({ page }) => {
  await load(page);
});

test("no update button until an update is available", async ({ page }) => {
  await expect(page.locator('[data-testid="update-button"]')).toHaveCount(0);
});

test("update-available event shows the New Release button, click installs", async ({ page }) => {
  await page.evaluate(() => window.__TEST_EMIT__("update-available", "9.9.9"));

  const btn = page.locator('[data-testid="update-button"]');
  await expect(btn).toContainText("New Release 9.9.9");

  await btn.click();
  await expect(btn).toContainText("Updating");
});
