import { test, expect, Page } from "@playwright/test";

async function load(page: Page) {
  await page.addInitScript({ path: "tests/mocks/tauri-ipc.js" });
  await page.goto("/");
  await page.waitForSelector('[data-testid="tab"]');
}

test.beforeEach(async ({ page }) => {
  await load(page);
});

test("no screenshots tab until one is captured", async ({ page }) => {
  await expect(page.locator('[data-testid="screenshots-tab"]')).toHaveCount(0);
});

test("capture opens screenshots tab with an image", async ({ page }) => {
  await page.locator('[data-testid="screenshot-button"]').click();

  const screensTab = page.locator('[data-testid="screenshots-tab"]');
  await expect(screensTab).toBeVisible();
  await expect(screensTab).toHaveAttribute("data-active", "true");

  await expect(page.locator('[data-testid="shot-card"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="gallery"] img')).toBeVisible();
});

test("each shot has copy and delete; delete removes it and closes the tab", async ({ page }) => {
  await page.locator('[data-testid="screenshot-button"]').click();
  await expect(page.locator('[data-testid="shot-card"]')).toHaveCount(1);

  await expect(page.locator('[data-testid="shot-copy"]')).toBeVisible();
  await page.locator('[data-testid="shot-delete"]').click();

  await expect(page.locator('[data-testid="shot-card"]')).toHaveCount(0);
  // Tab disappears and view falls back to the note editor
  await expect(page.locator('[data-testid="screenshots-tab"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="editor"]')).toBeVisible();
});

test("copy button shows transient 'Copied' feedback", async ({ page }) => {
  await page.locator('[data-testid="screenshot-button"]').click();
  const copy = page.locator('[data-testid="shot-copy"]');
  await expect(copy).toHaveText("Copy");
  await copy.click();
  await expect(copy).toHaveText(/Copied/);
  // reverts after the timeout
  await expect(copy).toHaveText("Copy", { timeout: 2000 });
});

test("global take-screenshot event captures like the button", async ({ page }) => {
  await page.evaluate(() => window.__TEST_EMIT__("take-screenshot", null));

  await expect(page.locator('[data-testid="screenshots-tab"]')).toBeVisible();
  await expect(page.locator('[data-testid="shot-card"]')).toHaveCount(1);
});

test("clicking a note tab leaves the screenshots view", async ({ page }) => {
  await page.locator('[data-testid="screenshot-button"]').click();
  await expect(page.locator('[data-testid="gallery"]')).toBeVisible();

  await page.locator('[data-testid="tab"]').first().click();
  await expect(page.locator('[data-testid="gallery"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="editor"]')).toBeVisible();
  await expect(page.locator('[data-testid="screenshots-tab"]')).toHaveAttribute(
    "data-active",
    "false"
  );
});

test("thumbnail is clickable to open in the OS viewer", async ({ page }) => {
  await page.locator('[data-testid="screenshot-button"]').click();
  await expect(page.locator('[data-testid="shot-card"]')).toHaveCount(1);

  const openImg = page.locator('[data-testid="shot-open"]');
  await expect(openImg).toBeVisible();
  // Clicking calls invoke("open_screenshot", ...) — mocked to resolve null.
  // Real OS-viewer behavior (Preview.app) and the CSP data: fix can't be
  // exercised here; this only verifies the click wiring doesn't throw.
  await openImg.click();
  await expect(page.locator('[data-testid="shot-card"]')).toHaveCount(1);
});

test("delete all clears the gallery and closes the tab", async ({ page }) => {
  await page.locator('[data-testid="screenshot-button"]').click();
  await expect(page.locator('[data-testid="shot-card"]')).toHaveCount(1);
  await page.evaluate(() => window.__TEST_EMIT__("take-screenshot", null));
  await expect(page.locator('[data-testid="shot-card"]')).toHaveCount(2);

  await page.locator('[data-testid="shot-delete-all"]').click();

  await expect(page.locator('[data-testid="shot-card"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="screenshots-tab"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="editor"]')).toBeVisible();
});

test("copy-note button appears for an active text note and is clickable", async ({ page }) => {
  await expect(page.locator('[data-testid="copy-note"]')).toBeVisible();
  // navigator.clipboard.writeText may be unavailable/unpermitted in this
  // headless context; the app falls back to invoke("copy_text") (mocked to
  // resolve null either way). This only verifies the button renders and the
  // click doesn't throw — real clipboard contents aren't asserted here.
  await page.locator('[data-testid="copy-note"]').click();
});

test("copy-note button is hidden while viewing screenshots", async ({ page }) => {
  await page.locator('[data-testid="screenshot-button"]').click();
  await expect(page.locator('[data-testid="gallery"]')).toBeVisible();
  await expect(page.locator('[data-testid="copy-note"]')).toHaveCount(0);
});
