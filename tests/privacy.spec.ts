import { test, expect, Page } from "@playwright/test";

async function load(page: Page) {
  await page.addInitScript({ path: "tests/mocks/tauri-ipc.js" });
  await page.goto("/");
  await page.waitForSelector('[data-testid="tab"]');
  // Wait for React effects to register all event listeners (listen() calls are async)
  await page.waitForTimeout(100);
}

async function enablePrivacy(page: Page) {
  await page.evaluate(() =>
    window.__TEST_EMIT__("toggle-privacy", null)
  );
}

test.beforeEach(async ({ page }) => {
  await load(page);
});

test("privacy mode masks content with bullet characters", async ({ page }) => {
  const editor = page.locator('[data-testid="editor"]');
  await editor.fill("secret");
  await page.waitForTimeout(700);

  await enablePrivacy(page);

  // Content should be 6 bullets matching "secret".length
  await expect(editor).toHaveValue("••••••");
  await expect(editor).toHaveAttribute("readonly", "");
});

test("privacy textarea cannot be edited by user", async ({ page }) => {
  const editor = page.locator('[data-testid="editor"]');
  await editor.fill("secret");
  await page.waitForTimeout(700);

  await enablePrivacy(page);
  const maskedValue = await editor.inputValue();

  // Try to type into the readonly textarea
  await editor.click();
  await page.keyboard.type("hack");

  // Value must not have changed
  await expect(editor).toHaveValue(maskedValue);
});

test("toggling privacy off restores editable content", async ({ page }) => {
  const editor = page.locator('[data-testid="editor"]');
  await editor.fill("secret");
  await page.waitForTimeout(700);

  await enablePrivacy(page);
  await expect(editor).toHaveAttribute("readonly", "");

  // Toggle off
  await enablePrivacy(page);
  await expect(editor).not.toHaveAttribute("readonly");
  await expect(editor).toHaveValue("secret");
});

test("privacy flag survives tab switch", async ({ page }) => {
  // Enable privacy on tab A
  const editor = page.locator('[data-testid="editor"]');
  await editor.fill("classified");
  await page.waitForTimeout(700);
  await enablePrivacy(page);
  await expect(editor).toHaveAttribute("readonly", "");

  // Create and switch to tab B
  await page.locator('[data-testid="add-tab"]').click();
  await page.locator('[data-testid="tab"]').last().click();
  await expect(page.locator('[data-testid="editor"]')).not.toHaveAttribute(
    "readonly"
  );

  // Switch back to tab A
  await page.locator('[data-testid="tab"]').first().click();

  // Still masked
  await expect(page.locator('[data-testid="editor"]')).toHaveAttribute(
    "readonly",
    ""
  );
});
