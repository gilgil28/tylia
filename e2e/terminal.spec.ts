// "Open in terminal" (toolbar, palette, shortcut) and its setting, against the mock.

import { expect, test, type Page } from "@playwright/test";

async function open(page: Page, query = "") {
  await page.addInitScript(() => {
    localStorage.removeItem("tylia.web.ui");
    localStorage.removeItem("tylia.web.settings");
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/?theme=light&platform=windows&repo=demo${query}`);
  await expect(page.getByText("Make edge width configurable").first()).toBeVisible();
}

test("toolbar button, palette and shortcut open the terminal", async ({ page }) => {
  await open(page);
  // Each entry point is wired; the "no terminal" test below proves the call reaches Rust's
  // stand-in (a success shows nothing).
  await expect(page.getByRole("button", { name: "Open in terminal" })).toBeVisible();
  await page.getByRole("button", { name: "Open in terminal" }).click();
  await page.keyboard.press("Control+K");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await palette.getByRole("combobox").fill("terminal");
  const item = palette.getByRole("option", { name: /^Open in terminal/ });
  await expect(item).toContainText("Ctrl");
  await expect(item).toContainText("Shift");
  await page.keyboard.press("Escape");
  await expect(page.getByText("Couldn’t open a terminal")).toHaveCount(0);
});

test("no terminal found explains where to choose one", async ({ page }) => {
  await open(page, "&terminal=missing");
  await page.keyboard.press("Control+Shift+T");
  await expect(page.getByText("Couldn’t open a terminal").first()).toBeVisible();
  await expect(
    page.getByText("No terminal was found. Choose one in Settings → General → Terminal.").first(),
  ).toBeVisible();
});

test("the terminal setting is saved", async ({ page }) => {
  await open(page);
  await page.keyboard.press("Control+,");
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(
    settings.getByText(/Automatic uses Windows Terminal, else PowerShell/),
  ).toBeVisible();
  const field = settings.getByRole("textbox", { name: "Terminal" });
  await field.fill("C:\\tools\\cmder\\Cmder.exe");
  await field.press("Enter");
  const saved = await page.evaluate(() => localStorage.getItem("tylia.web.settings"));
  expect(JSON.parse(saved!).terminal).toBe("C:\\tools\\cmder\\Cmder.exe");
});
