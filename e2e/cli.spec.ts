// macOS's "Install the tylia command" palette action, against the mock (`?cli=` simulates
// an existing link or a dismissed password prompt).

import { expect, test, type Page } from "@playwright/test";

async function open(page: Page, platform: string, query = "") {
  await page.addInitScript(() => {
    localStorage.removeItem("tylia.web.ui");
    localStorage.removeItem("tylia.web.settings");
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/?theme=light&platform=${platform}&repo=demo${query}`);
  await expect(page.getByText("Make edge width configurable").first()).toBeVisible();
}

async function runFromPalette(page: Page, mod: "Meta" | "Control") {
  await page.keyboard.press(`${mod}+K`);
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await palette.getByRole("combobox").fill("install the tylia");
  return palette;
}

test("macOS installs the command and says how to use it", async ({ page }) => {
  await open(page, "macos");
  const palette = await runFromPalette(page, "Meta");
  await palette.getByRole("combobox").press("Enter");
  await expect(page.getByText("The tylia command is installed").first()).toBeVisible();
  await expect(page.getByText(/tylia \. for the current one/).first()).toBeVisible();
});

test("an existing link is reported, a dismissed password prompt is silent", async ({ page }) => {
  await open(page, "macos", "&cli=installed");
  let palette = await runFromPalette(page, "Meta");
  await palette.getByRole("combobox").press("Enter");
  await expect(page.getByText("The tylia command is already installed").first()).toBeVisible();

  await open(page, "macos", "&cli=cancelled");
  palette = await runFromPalette(page, "Meta");
  await palette.getByRole("combobox").press("Enter");
  await expect(palette).toBeHidden();
  await expect(page.getByText(/The tylia command is/)).toHaveCount(0);
});

test("other platforms don't offer it", async ({ page }) => {
  await open(page, "windows");
  const palette = await runFromPalette(page, "Control");
  await expect(palette.getByRole("option", { name: /Install the tylia command/ })).toHaveCount(0);
});
