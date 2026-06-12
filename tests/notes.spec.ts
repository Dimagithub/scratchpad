import { test, expect, Page } from "@playwright/test";

async function load(page: Page) {
  await page.addInitScript({ path: "tests/mocks/tauri-ipc.js" });
  await page.goto("/");
  // Wait for the auto-created first tab to appear
  await page.waitForSelector('[data-testid="tab"]');
}

test.beforeEach(async ({ page }) => {
  await load(page);
});

test("auto-creates first note on load", async ({ page }) => {
  const tabs = page.locator('[data-testid="tab"]');
  await expect(tabs).toHaveCount(1);
  const title = page.locator('[data-testid="tab-title"]').first();
  await expect(title).toContainText("Notepad");
});

test("add note creates a second tab", async ({ page }) => {
  await page.locator('[data-testid="add-tab"]').click();
  const tabs = page.locator('[data-testid="tab"]');
  await expect(tabs).toHaveCount(2);
});

test("clicking a tab makes it active", async ({ page }) => {
  await page.locator('[data-testid="add-tab"]').click();
  await page.waitForSelector('[data-testid="tab"][data-active="false"]');

  // Click the first (inactive) tab
  const firstTab = page.locator('[data-testid="tab"]').first();
  await firstTab.click();

  await expect(firstTab).toHaveAttribute("data-active", "true");
});

test("closing a tab removes it", async ({ page }) => {
  await page.locator('[data-testid="add-tab"]').click();
  await expect(page.locator('[data-testid="tab"]')).toHaveCount(2);

  // Close the first tab
  await page.locator('[data-testid="tab-close"]').first().click();
  await expect(page.locator('[data-testid="tab"]')).toHaveCount(1);
});

test("closing last note shows empty state", async ({ page }) => {
  await page.locator('[data-testid="tab-close"]').click();
  await expect(page.locator('[data-testid="empty-state"]')).toBeVisible();
  await expect(page.locator('[data-testid="tab"]')).toHaveCount(0);
});

test("double-click tab title to rename, Enter confirms", async ({ page }) => {
  const title = page.locator('[data-testid="tab-title"]').first();
  await title.dblclick();

  const input = page.locator('[data-testid="tab"] input');
  await input.fill("My Renamed Note");
  await input.press("Enter");

  await expect(page.locator('[data-testid="tab-title"]').first()).toHaveText(
    "My Renamed Note"
  );
});

test("Escape during rename cancels and restores title", async ({ page }) => {
  const originalTitle = await page
    .locator('[data-testid="tab-title"]')
    .first()
    .textContent();

  const title = page.locator('[data-testid="tab-title"]').first();
  await title.dblclick();

  const input = page.locator('[data-testid="tab"] input');
  await input.fill("Unwanted Name");
  await input.press("Escape");

  await expect(page.locator('[data-testid="tab-title"]').first()).toHaveText(
    originalTitle!
  );
});

test("content typed in a tab persists after switching tabs and back", async ({
  page,
}) => {
  // Type in tab A (already active)
  const editor = page.locator('[data-testid="editor"]');
  await editor.click();
  await editor.fill("persistent text");

  // Wait for 600ms debounce + buffer
  await page.waitForTimeout(700);

  // Create and switch to tab B
  await page.locator('[data-testid="add-tab"]').click();
  await expect(page.locator('[data-testid="tab"]')).toHaveCount(2);

  // Switch back to tab A (first tab)
  await page.locator('[data-testid="tab"]').first().click();

  // Content should be restored
  await expect(page.locator('[data-testid="editor"]')).toHaveValue(
    "persistent text"
  );
});
