import { test, expect, Page } from "@playwright/test";

async function load(page: Page) {
  await page.addInitScript({ path: "tests/mocks/tauri-ipc.js" });
  await page.goto("/");
  await page.waitForSelector('[data-testid="tab"]');
  await page.waitForTimeout(100);
}

test.beforeEach(async ({ page }) => {
  await load(page);
});

// The help entry lives in the native View menu, which emits "show-help".
const openViaMenu = (page: Page) =>
  page.evaluate(() => window.__TEST_EMIT__("show-help", null));

test("there is no help button in the toolbar", async ({ page }) => {
  await expect(page.locator('[data-testid="help-button"]')).toHaveCount(0);
});

test("View → Quick Help opens the modal with recognizable content", async ({ page }) => {
  await openViaMenu(page);
  const modal = page.locator('[data-testid="help-modal"]');
  await expect(modal).toBeVisible();
  await expect(modal).toContainText("⌘F");
  await expect(modal).toContainText("Screenshots");
});

test("the × button closes the help modal", async ({ page }) => {
  await openViaMenu(page);
  await expect(page.locator('[data-testid="help-modal"]')).toBeVisible();
  await page.locator('[data-testid="help-close"]').click();
  await expect(page.locator('[data-testid="help-modal"]')).toHaveCount(0);
});

test("pressing Escape closes the help modal", async ({ page }) => {
  await openViaMenu(page);
  await expect(page.locator('[data-testid="help-modal"]')).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-testid="help-modal"]')).toHaveCount(0);
});

test("clicking the backdrop closes the help modal", async ({ page }) => {
  await openViaMenu(page);
  await expect(page.locator('[data-testid="help-modal"]')).toBeVisible();
  await page.locator('[data-testid="help-modal"]').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('[data-testid="help-modal"]')).toHaveCount(0);
});

test("pressing ? opens the help modal", async ({ page }) => {
  await page.keyboard.press("?");
  await expect(page.locator('[data-testid="help-modal"]')).toBeVisible();
});
