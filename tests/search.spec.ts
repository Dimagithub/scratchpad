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

test.beforeEach(async ({ page }) => {
  await load(page);
  // content has "foo" x2, plus "Foo" and "FOO"
  await page.locator('[data-testid="editor"]').fill("foo bar Foo FOO foo");
  await page.waitForTimeout(700);
});

test("case-sensitive search counts and selects matches, Next advances", async ({ page }) => {
  await page.locator('[data-testid="search-toggle"]').click();
  await page.locator('[data-testid="search-input"]').fill("foo");

  await expect(page.locator('[data-testid="search-count"]')).toHaveText("1/2");
  expect(await selection(page)).toEqual([0, 3]);

  await page.locator('[data-testid="search-next"]').click();
  await expect(page.locator('[data-testid="search-count"]')).toHaveText("2/2");
  expect(await selection(page)).toEqual([16, 19]);

  // wraps around
  await page.locator('[data-testid="search-next"]').click();
  await expect(page.locator('[data-testid="search-count"]')).toHaveText("1/2");
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
