// Opt-in update check (Settings → General, the palette) and the update dialog, against the
// mock (`?update=available|failed` simulates the release server).

import { expect, test, type Page } from "@playwright/test";

const shot = (page: Page, name: string) =>
  page.screenshot({ path: `e2e/__screenshots__/${name}.png`, animations: "disabled" });

async function open(page: Page, query = "", theme = "light") {
  await page.addInitScript(() => {
    localStorage.removeItem("tylia.web.ui");
    localStorage.removeItem("tylia.web.settings");
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/?theme=${theme}&platform=windows&repo=demo${query}`);
  await expect(page.getByText("Make edge width configurable").first()).toBeVisible();
}

async function openSettings(page: Page) {
  await page.keyboard.press("Control+,");
  return page.getByRole("dialog", { name: "Settings" });
}

test("update check is off by default and reports the latest version", async ({ page }) => {
  await open(page);
  const settings = await openSettings(page);
  const toggle = settings.getByRole("checkbox", { name: "Check for updates when Tylia starts" });
  await expect(toggle).not.toBeChecked();
  await expect(settings.getByText("Not checked yet.")).toBeVisible();
  await settings.getByRole("button", { name: "Check now" }).click();
  await expect(settings.getByText(/Tylia \d+\.\d+\.\d+ is the latest version\./)).toBeVisible();
});

for (const theme of ["light", "dark"]) {
  test(`update dialog installs with progress (${theme})`, async ({ page }) => {
    await open(page, "&update=available", theme);
    const settings = await openSettings(page);
    await settings.getByRole("button", { name: "Check now" }).click();
    const dialog = page.getByRole("dialog", { name: "Tylia 0.2.0 is available" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("git-flow helpers", { exact: false })).toBeVisible();
    await shot(page, `update-dialog-${theme}`);
    await dialog.getByRole("button", { name: "Install and restart" }).click();
    await expect(dialog.getByText(/Downloading… [\d.]+ of 11\.4 MB/)).toBeVisible();
  });
}

test("a failed manual check is shown inline in Settings", async ({ page }) => {
  await open(page, "&update=failed");
  const settings = await openSettings(page);
  await settings.getByRole("button", { name: "Check now" }).click();
  await expect(
    settings.getByText(/^Couldn’t check for updates: error sending request/),
  ).toBeVisible();
  await shot(page, "update-settings-failed-light");
});

test("the palette checks for updates", async ({ page }) => {
  await open(page);
  await page.keyboard.press("Control+K");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await palette.getByRole("combobox").fill("check for updates");
  await palette.getByRole("combobox").press("Enter");
  await expect(page.getByText(/is the latest version/).first()).toBeVisible();
});

test("with the setting on, the start-up check announces an update", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.removeItem("tylia.web.ui");
    localStorage.setItem("tylia.web.settings", JSON.stringify({ checkForUpdates: true }));
  });
  await page.clock.install();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/?theme=light&platform=windows&repo=demo&update=available`);
  await expect(page.getByText("Make edge width configurable").first()).toBeVisible();
  await page.clock.runFor(6000);
  await page.getByRole("button", { name: "View update" }).click();
  await expect(page.getByRole("dialog", { name: "Tylia 0.2.0 is available" })).toBeVisible();
});

test("a Flatpak leaves updates to Flathub", async ({ page }) => {
  await open(page, "&distribution=flatpak&update=available", "light");
  const settings = await openSettings(page);
  await expect(settings.getByText(/Flathub keeps this copy up to date/)).toBeVisible();
  await expect(settings.getByRole("button", { name: "Check now" })).toHaveCount(0);
  await expect(
    settings.getByRole("checkbox", { name: "Check for updates when Tylia starts" }),
  ).toHaveCount(0);
  await shot(page, "update-settings-flatpak-light");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+K");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await palette.getByRole("combobox").fill("check for updates");
  await expect(palette.getByRole("option", { name: /Check for updates/ })).toHaveCount(0);
});

test("a pacman package points to pacman for the update", async ({ page }) => {
  await open(page, "&distribution=pacman&update=available", "dark");
  const settings = await openSettings(page);
  await settings.getByRole("button", { name: "Check now" }).click();
  const dialog = page.getByRole("dialog", { name: "Tylia 0.2.0 is available" });
  await expect(dialog.getByText(/installed with pacman \(from the AUR\)/)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Open download page" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Install and restart" })).toHaveCount(0);
  await shot(page, "update-dialog-pacman-dark");
});
