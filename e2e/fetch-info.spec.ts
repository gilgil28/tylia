// Fetch's tooltip says when the repository last fetched.

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

test("Fetch's tooltip says when the repository last fetched", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: /^Fetch(?! options)/ }).hover();
  await expect(page.getByRole("tooltip")).toContainText("Last fetched 25 minutes ago");
});
