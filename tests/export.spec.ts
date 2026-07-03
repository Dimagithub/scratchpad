import { test, expect, Page } from "@playwright/test";

async function load(page: Page) {
  await page.addInitScript({ path: "tests/mocks/tauri-ipc.js" });
  await page.goto("/");
  await page.waitForSelector('[data-testid="tab"]');
}

test.beforeEach(async ({ page }) => {
  await load(page);
});

test("Export writes the active note's live content to the chosen path", async ({ page }) => {
  await page.locator('[data-testid="editor"]').fill("hello export");
  await page.evaluate(() => window.__TEST_EMIT__("export-note-to", "/tmp/out.txt"));

  await expect
    .poll(() => page.evaluate(() => window.__TEST_LAST_EXPORT__))
    .toEqual({ path: "/tmp/out.txt", content: "hello export" });
});
