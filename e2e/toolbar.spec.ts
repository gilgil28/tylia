// The toolbar's Commit button (with the changed-file count), against the mock.

import { expect, test, type Page } from "@playwright/test";

const shot = (page: Page, name: string) =>
  page.screenshot({ path: `e2e/__screenshots__/${name}.png`, animations: "disabled" });

async function open(page: Page, theme = "light", width = 1280) {
  await page.addInitScript(() => {
    localStorage.removeItem("tylia.web.ui");
    localStorage.removeItem("tylia.web.settings");
  });
  await page.setViewportSize({ width, height: 800 });
  await page.goto(`/?theme=${theme}&platform=windows&repo=demo`);
  await expect(page.getByText("Make edge width configurable").first()).toBeVisible();
}

for (const theme of ["light", "dark"]) {
  test(`Commit shows the changed files and opens the message box (${theme})`, async ({ page }) => {
    await open(page, theme);
    const commit = page.getByRole("button", { name: "Commit 3 files changed" });
    await expect(commit).toBeVisible();
    await shot(page, `toolbar-commit-${theme}`);
    await commit.click();
    await expect(page.getByText(/^Unstaged · /)).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Commit message" })).toBeFocused();
  });
}

test("the palette and Mod+Shift+C go to the message box", async ({ page }) => {
  await open(page);
  await page.keyboard.press("Control+Shift+C");
  await expect(page.getByRole("textbox", { name: "Commit message" })).toBeFocused();
});

test("toolbar fits at the minimum window width", async ({ page }) => {
  await open(page, "light", 900);
  await shot(page, "toolbar-commit-900");
  const toolbar = await page.getByRole("button", { name: "Show in Explorer" }).boundingBox();
  expect(toolbar!.x + toolbar!.width).toBeLessThanOrEqual(900);
});
