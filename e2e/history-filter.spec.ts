// The history search and branch filter on their own row above the history.

import { expect, test, type Page } from "@playwright/test";

async function open(page: Page, theme = "light", width = 1280) {
  await page.addInitScript(() => {
    localStorage.removeItem("tylia.web.ui");
    localStorage.removeItem("tylia.web.settings");
  });
  await page.setViewportSize({ width, height: 800 });
  await page.goto(`/?theme=${theme}&platform=windows&repo=demo`);
  await expect(page.getByText("Make edge width configurable").first()).toBeVisible();
}

test("search and the branch filter sit above the history; Mod+F reaches them", async ({ page }) => {
  await open(page);
  const search = page.getByRole("textbox", { name: "Search history" });
  await expect(search).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: "Branches shown" })).toBeVisible();
  // From the Changes view, Mod+F returns to the history and focuses the search.
  await page.keyboard.press("Alt+1");
  await expect(search).toHaveCount(0);
  await page.keyboard.press("Control+F");
  await expect(page.getByRole("textbox", { name: "Search history" })).toBeFocused();
});
