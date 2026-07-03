import { test, expect, Page } from "@playwright/test";

async function load(page: Page) {
  await page.addInitScript({ path: "tests/mocks/tauri-ipc.js" });
  await page.goto("/");
  await page.waitForSelector('[data-testid="tab"]');
}

test.beforeEach(async ({ page }) => {
  await load(page);
});

test("Import adds the emitted note as a new active tab", async ({ page }) => {
  const before = await page.locator('[data-testid="tab"]').count();

  await page.evaluate(() =>
    window.__TEST_EMIT__("note-imported", {
      id: "imported-1",
      title: "shopping-list",
      content: "milk\neggs",
      created_at: Date.now(),
      private: false,
    })
  );

  await expect(page.locator('[data-testid="tab"]')).toHaveCount(before + 1);
  const activeTab = page.locator('[data-testid="tab"][data-active="true"] [data-testid="tab-title"]');
  await expect(activeTab).toHaveText("shopping-list");
  await expect(page.locator('[data-testid="editor"]')).toHaveValue("milk\neggs");
});
