// The browser's own context menu (Refresh, Save as, Print…) is suppressed except in text
// fields and on selected text; Tylia's menus still open.

import { expect, test, type Page } from "@playwright/test";

/** Right-clicks the first element matching `selector`; true if the browser menu would show. */
const browserMenuShows = (page: Page, selector: string) =>
  page.evaluate((s) => {
    const target = document.querySelector(s)!;
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 });
    return target.dispatchEvent(event);
  }, selector);

test("only text fields and selected text keep the browser's menu", async ({ page }) => {
  await page.goto("/?theme=light&platform=windows&repo=demo");
  await expect(page.getByText("Make edge width configurable").first()).toBeVisible();

  expect(await browserMenuShows(page, "body")).toBe(false);
  expect(await browserMenuShows(page, "header, nav, aside")).toBe(false);
  expect(await browserMenuShows(page, "input")).toBe(true);

  await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector("[data-selectable]") ?? document.body);
    window.getSelection()!.addRange(range);
  });
  expect(await browserMenuShows(page, "body")).toBe(true);
  await page.evaluate(() => window.getSelection()!.removeAllRanges());

  // Tylia's own menus are unaffected.
  await page
    .getByRole("row")
    .filter({ hasText: "Make edge width configurable" })
    .first()
    .click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Save as patch…" })).toBeVisible();
});
