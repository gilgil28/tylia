// Tooltips open on keyboard focus only, not when a menu hands focus back.

import { expect, test, type Page } from "@playwright/test";

async function open(page: Page, theme = "light") {
  await page.addInitScript(() => {
    localStorage.removeItem("tylia.web.ui");
    localStorage.removeItem("tylia.web.settings");
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/?theme=${theme}&platform=windows&repo=demo`);
  await expect(page.getByText("Make edge width configurable").first()).toBeVisible();
}

test("a tooltip doesn't come back when a menu closes with the mouse", async ({ page }) => {
  await open(page);
  const trigger = page.getByRole("button", { name: "Pull options" });
  await trigger.click();
  await expect(page.getByRole("menu")).toBeVisible();
  // Click elsewhere: the menu closes and hands focus back to its button.
  await page.mouse.click(700, 450);
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.waitForTimeout(900);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  // After keyboard input, focus does show the tooltip.
  await page.mouse.move(700, 450);
  await page.keyboard.press("Shift");
  await page.getByRole("banner").getByRole("button", { name: "Settings" }).focus();
  await expect(page.getByRole("tooltip").first()).toContainText("Settings");
});
