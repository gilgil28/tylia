// Command palette, shortcuts (with rebinding) and the Settings screen, against the mock.

import { expect, test, type Page } from "@playwright/test";

const shot = (page: Page, name: string) =>
  page.screenshot({ path: `e2e/__screenshots__/${name}.png`, animations: "disabled" });

async function openDemo(page: Page, theme = "light") {
  await page.addInitScript(() => {
    localStorage.removeItem("tylia.web.ui");
    localStorage.removeItem("tylia.web.settings");
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/?theme=${theme}&platform=windows&repo=demo`);
  await expect(page.getByText("Make edge width configurable").first()).toBeVisible();
}

const toastText = (page: Page, text: string | RegExp) => page.getByText(text).first();

for (const theme of ["light", "dark"]) {
  test(`palette runs actions and finds branches (${theme})`, async ({ page }) => {
    await openDemo(page, theme);
    await page.keyboard.press("Control+K");
    const palette = page.getByRole("dialog", { name: "Command palette" });
    await expect(palette.getByRole("combobox")).toBeFocused();
    await shot(page, `palette-empty-${theme}`);
    await palette.getByRole("combobox").fill("switch parser");
    await expect(palette.getByRole("option", { name: /Switch to feature\/parser/ })).toBeVisible();
    await shot(page, `palette-search-${theme}`);
    await palette.getByRole("combobox").press("Enter");
    await expect(palette).toHaveCount(0);
    await expect(toastText(page, "Switched to feature/parser")).toBeVisible();
  });
}

test("palette opens dialogs and shows shortcuts", async ({ page }) => {
  await openDemo(page);
  await page.keyboard.press("Control+K");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await palette.getByRole("combobox").fill("new branch");
  const item = palette.getByRole("option", { name: /^New branch…/ });
  await expect(item).toContainText("Ctrl");
  await item.click();
  await expect(page.getByRole("dialog", { name: "New branch" })).toBeVisible();
});

test("shortcuts switch views and toggle the sidebar", async ({ page }) => {
  await openDemo(page);
  await page.keyboard.press("Alt+1");
  await expect(page.getByText(/^Unstaged · /)).toBeVisible();
  await page.keyboard.press("Alt+2");
  await expect(page.getByText("Make edge width configurable").first()).toBeVisible();
  const filter = page.getByRole("navigation").getByPlaceholder("Filter");
  await expect(filter).toBeVisible();
  await page.keyboard.press("Control+B");
  await expect(filter).toBeHidden();
  await page.keyboard.press("Control+B");
  await expect(filter).toBeVisible();
});

test("shortcuts don't fire while typing (unless they use Mod)", async ({ page }) => {
  await openDemo(page);
  await page.keyboard.press("Control+F");
  await expect(page.getByRole("textbox", { name: "Search history" })).toBeFocused();
  await page.keyboard.press("F5");
  await page.keyboard.type("x");
  await expect(page.getByRole("textbox", { name: "Search history" })).toHaveValue("x");
});

for (const theme of ["light", "dark"]) {
  test(`settings: density and rebinding a shortcut (${theme})`, async ({ page }) => {
    await openDemo(page, theme);
    await page.keyboard.press("Control+,");
    const settings = page.getByRole("dialog", { name: "Settings" });
    await expect(settings).toBeVisible();
    await shot(page, `settings-general-${theme}`);
    await settings.getByRole("radio", { name: "Compact" }).click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.density))
      .toBe("compact");

    await settings.getByRole("button", { name: "Keyboard" }).click();
    await settings.getByPlaceholder("Filter by action or shortcut").fill("new branch");
    await settings.getByRole("button", { name: /change the shortcut for New branch…/ }).click();
    await page.keyboard.press("Control+Alt+N");
    await expect(settings.getByRole("row", { name: /New branch…/ })).toContainText("Alt");
    await settings.getByPlaceholder("Filter by action or shortcut").fill("");
    await shot(page, `settings-keyboard-${theme}`);
    await page.keyboard.press("Escape");
    await expect(settings).toHaveCount(0);

    await page.keyboard.press("Control+Alt+N");
    await expect(page.getByRole("dialog", { name: "New branch" })).toBeVisible();
    await page.keyboard.press("Escape");
    // The old shortcut no longer does anything.
    await page.keyboard.press("Control+Shift+B");
    await expect(page.getByRole("dialog", { name: "New branch" })).toHaveCount(0);
  });
}

test("hover underlines the first-parent line; Alt+↓/↑ jump along it", async ({ page }) => {
  await openDemo(page, "dark");
  const row = page.getByRole("row").filter({ hasText: "Handle no-newline markers" }).first();
  await row.hover();
  await page.waitForTimeout(200);
  await shot(page, "graph-hover-dark");
  await row.click();
  await expect(page.getByRole("heading", { name: "Handle no-newline markers" })).toBeVisible();
  await page.keyboard.press("Alt+ArrowDown");
  await expect(page.getByRole("heading", { name: "Stage selected lines" })).toBeVisible();
  await page.keyboard.press("Alt+ArrowUp");
  await expect(page.getByRole("heading", { name: "Handle no-newline markers" })).toBeVisible();
});
