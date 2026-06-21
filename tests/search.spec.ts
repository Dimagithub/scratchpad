import { test, expect, Page } from "@playwright/test";

async function load(page: Page) {
  await page.addInitScript({ path: "tests/mocks/tauri-ipc.js" });
  await page.goto("/");
  await page.waitForSelector('[data-testid="tab"]');
  await page.waitForTimeout(100);
}

async function selection(page: Page) {
  return page
    .locator('[data-testid="editor"]')
    .evaluate((el) => [(el as HTMLTextAreaElement).selectionStart, (el as HTMLTextAreaElement).selectionEnd]);
}

async function focusedTestId(page: Page) {
  return page.evaluate(() => document.activeElement?.getAttribute("data-testid"));
}

test.beforeEach(async ({ page }) => {
  await load(page);
  // content has "foo" x2, plus "Foo" and "FOO"
  await page.locator('[data-testid="editor"]').fill("foo bar Foo FOO foo");
  await page.waitForTimeout(700);
});

test("pressing Enter selects the match AND focuses the editor so it highlights", async ({ page }) => {
  await page.locator('[data-testid="search-toggle"]').click();
  await page.locator('[data-testid="search-input"]').fill("foo");
  await expect(page.locator('[data-testid="search-count"]')).toHaveText("1/2");

  await page.locator('[data-testid="search-input"]').press("Enter");

  // selection lands on the first match and the editor is focused (highlight visible)
  expect(await selection(page)).toEqual([0, 3]);
  expect(await focusedTestId(page)).toBe("editor");
});

test("Next cycles through matches and wraps", async ({ page }) => {
  await page.locator('[data-testid="search-toggle"]').click();
  await page.locator('[data-testid="search-input"]').fill("foo");

  // first nav lands on match 0
  await page.locator('[data-testid="search-next"]').click();
  await expect(page.locator('[data-testid="search-count"]')).toHaveText("1/2");
  expect(await selection(page)).toEqual([0, 3]);

  await page.locator('[data-testid="search-next"]').click();
  await expect(page.locator('[data-testid="search-count"]')).toHaveText("2/2");
  expect(await selection(page)).toEqual([16, 19]);

  // wraps back to the first
  await page.locator('[data-testid="search-next"]').click();
  await expect(page.locator('[data-testid="search-count"]')).toHaveText("1/2");
  expect(await selection(page)).toEqual([0, 3]);
});

test("toggling case-insensitive widens the match set", async ({ page }) => {
  await page.locator('[data-testid="search-toggle"]').click();
  await page.locator('[data-testid="search-input"]').fill("foo");
  await expect(page.locator('[data-testid="search-count"]')).toHaveText("1/2");

  await page.locator('[data-testid="search-case"]').click();
  await expect(page.locator('[data-testid="search-count"]')).toHaveText("1/4");
});

test("no matches shows 0/0", async ({ page }) => {
  await page.locator('[data-testid="search-toggle"]').click();
  await page.locator('[data-testid="search-input"]').fill("zzz");
  await expect(page.locator('[data-testid="search-count"]')).toHaveText("0/0");
});
