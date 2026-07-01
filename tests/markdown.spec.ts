import { test, expect, Page } from "@playwright/test";

async function load(page: Page) {
  await page.addInitScript({ path: "tests/mocks/tauri-ipc.js" });
  await page.goto("/");
  await page.waitForSelector('[data-testid="tab"]');
}

async function typeInEditor(page: Page, text: string) {
  const editor = page.locator('[data-testid="editor"]');
  await editor.click();
  await editor.fill(text);
}

test.beforeEach(async ({ page }) => {
  await load(page);
});

test("validate flags seeded markdown problems", async ({ page }) => {
  // Unclosed fence, broken link, heading jump.
  const bad = [
    "# Title",
    "### Skipped level",
    "[broken](http://example.com",
    "```js",
    "const x = 1;",
  ].join("\n");
  await typeInEditor(page, bad);

  await page.locator('[data-testid="md-validate"]').click();

  const results = page.locator('[data-testid="md-lint-results"]');
  await expect(results).toBeVisible();
  const items = page.locator('[data-testid="md-lint-item"]');
  // At least the three seeded issues
  await expect(items.first()).toBeVisible();
  const count = await items.count();
  expect(count).toBeGreaterThanOrEqual(3);

  const text = await results.innerText();
  expect(text).toContain("Unclosed fenced code block");
  expect(text).toContain("Broken link/image");
  expect(text.toLowerCase()).toContain("heading level");
});

test("validate reports OK for clean markdown", async ({ page }) => {
  const good = [
    "# Title",
    "",
    "Some text with a [link](http://example.com).",
    "",
    "## Section",
    "",
    "- item one",
    "- item two",
  ].join("\n");
  await typeInEditor(page, good);

  await page.locator('[data-testid="md-validate"]').click();
  await expect(page.locator('[data-testid="md-lint-ok"]')).toBeVisible();
  await expect(page.locator('[data-testid="md-lint-item"]')).toHaveCount(0);
});

test("lint results can be dismissed", async ({ page }) => {
  await typeInEditor(page, "# ok");
  await page.locator('[data-testid="md-validate"]').click();
  await expect(page.locator('[data-testid="md-lint-results"]')).toBeVisible();
  await page.locator('[data-testid="md-lint-close"]').click();
  await expect(page.locator('[data-testid="md-lint-results"]')).toHaveCount(0);
});

test("preview toggle shows a live-rendered, sanitized pane", async ({ page }) => {
  await page.locator('[data-testid="md-preview-toggle"]').click();
  const preview = page.locator('[data-testid="md-preview"]');
  await expect(preview).toBeVisible();

  await typeInEditor(page, "# Hello");
  await expect(preview.locator("h1")).toHaveText("Hello");

  // Copy-source button is present in the preview and clickable
  const copy = page.locator('[data-testid="md-preview-copy"]');
  await expect(copy).toBeVisible();
  await copy.click();

  // Editor and preview coexist
  await expect(page.locator('[data-testid="editor"]')).toBeVisible();
});

test("preview sanitizes dangerous html (no script executes)", async ({ page }) => {
  await page.locator('[data-testid="md-preview-toggle"]').click();
  await typeInEditor(page, "<img src=x onerror=alert(1)><script>window.__xss=1</script>\n\n# Safe");
  const preview = page.locator('[data-testid="md-preview"]');
  await expect(preview.locator("h1")).toHaveText("Safe");
  // Sanitizer strips <script>; nothing set window.__xss
  const xss = await page.evaluate(() => (window as unknown as { __xss?: number }).__xss);
  expect(xss).toBeUndefined();
});

test("markdown buttons hidden while viewing screenshots", async ({ page }) => {
  await page.locator('[data-testid="screenshot-button"]').click();
  await expect(page.locator('[data-testid="gallery"]')).toBeVisible();
  await expect(page.locator('[data-testid="md-validate"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="md-preview-toggle"]')).toHaveCount(0);
});

test("markdown buttons hidden for private notes", async ({ page }) => {
  // Toggle privacy on the active note
  await page.locator('[data-testid="privacy-toggle"]').click();
  await expect(page.locator('[data-testid="md-validate"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="md-preview-toggle"]')).toHaveCount(0);
});
