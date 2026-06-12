import { test, expect, Page } from "@playwright/test";

async function load(page: Page) {
  await page.addInitScript({ path: "tests/mocks/tauri-ipc.js" });
  await page.goto("/");
  await page.waitForSelector('[data-testid="tab"]');
}

async function getRootBg(page: Page): Promise<string> {
  return page
    .locator('[data-testid="app-root"]')
    .evaluate((el) => (el as HTMLElement).style.backgroundColor);
}

/** Browsers normalize rgba(r,g,b,1) → rgb(r,g,b), so we check the color values only. */
function isDark(bg: string): boolean {
  return bg.includes("30, 30, 30");
}

function isLight(bg: string): boolean {
  return bg.includes("255, 255, 255");
}

test.beforeEach(async ({ page }) => {
  await load(page);
});

test("default theme is dark", async ({ page }) => {
  const bg = await getRootBg(page);
  expect(isDark(bg)).toBe(true);
});

test("emitting settings-changed with light theme switches background", async ({
  page,
}) => {
  await page.evaluate(() =>
    window.__TEST_EMIT__("settings-changed", { theme: "light" })
  );

  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="app-root"]') as HTMLElement;
    return el?.style.backgroundColor.includes("255, 255, 255");
  });

  const bg = await getRootBg(page);
  expect(isLight(bg)).toBe(true);
});

test("emitting settings-changed with dark theme switches back", async ({
  page,
}) => {
  await page.evaluate(() =>
    window.__TEST_EMIT__("settings-changed", { theme: "light" })
  );
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="app-root"]') as HTMLElement;
    return el?.style.backgroundColor.includes("255, 255, 255");
  });

  await page.evaluate(() =>
    window.__TEST_EMIT__("settings-changed", { theme: "dark" })
  );
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="app-root"]') as HTMLElement;
    return el?.style.backgroundColor.includes("30, 30, 30");
  });

  const bg = await getRootBg(page);
  expect(isDark(bg)).toBe(true);
});

test("emitting settings-changed with opacity 0.5 updates background alpha", async ({
  page,
}) => {
  await page.evaluate(() =>
    window.__TEST_EMIT__("settings-changed", { opacity: 0.5 })
  );

  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="app-root"]') as HTMLElement;
    return el?.style.backgroundColor.includes("0.5");
  });

  const bg = await getRootBg(page);
  expect(bg).toContain("0.5");
});
