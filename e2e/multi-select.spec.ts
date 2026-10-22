// Several commits at once in the history, against the mock: Ctrl+click, Shift+click,
// Shift+↓, Esc, the summary in the details pane and the menu for the whole selection.

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

const row = (page: Page, subject: string) =>
  page.getByRole("row").filter({ hasText: subject }).first();

const toastText = (page: Page, text: string | RegExp) => page.getByText(text).first();

const selectedRows = (page: Page) => page.locator('[role="row"][aria-selected="true"]');

for (const theme of ["light", "dark"]) {
  test(`Ctrl+click and Shift+click select several commits (${theme})`, async ({ page }) => {
    await openDemo(page, theme);
    await row(page, "Make edge width configurable").click();
    await row(page, "Stage selected lines").click({ modifiers: ["Control"] });
    await expect(selectedRows(page)).toHaveCount(2);
    await expect(page.getByRole("heading", { name: "2 commits selected" })).toBeVisible();

    await row(page, "Build partial patches").click({ modifiers: ["Shift"] });
    // From the anchor (the last Ctrl+click) to here.
    await expect(selectedRows(page)).toHaveCount(2);
    await row(page, "Make edge width configurable").click();
    await row(page, "Build partial patches").click({ modifiers: ["Shift"] });
    await expect(selectedRows(page)).toHaveCount(4);
    await expect(page.getByRole("heading", { name: "4 commits selected" })).toBeVisible();
    await expect(page.getByText(/Lena Fischer \(1\)/)).toBeVisible();
    await shot(page, `history-multi-select-${theme}`);

    await page.keyboard.press("Escape");
    await expect(selectedRows(page)).toHaveCount(1);
    await expect(page.getByRole("heading", { name: /commits selected/ })).toHaveCount(0);
  });
}

test("Shift+↓ extends and a plain ↓ goes back to one", async ({ page }) => {
  await openDemo(page);
  await row(page, "Make edge width configurable").click();
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Shift+ArrowDown");
  await expect(selectedRows(page)).toHaveCount(3);
  await page.keyboard.press("ArrowDown");
  await expect(selectedRows(page)).toHaveCount(1);
});

test("the menu of a selection acts on all of it", async ({ page }) => {
  await openDemo(page);
  await row(page, "Handle no-newline markers").click();
  await row(page, "Build partial patches").click({ modifiers: ["Shift"] });
  await row(page, "Stage selected lines").click({ button: "right" });
  await expect(page.getByText("3 commits selected").last()).toBeVisible();
  // Single-commit items aren't offered.
  await expect(page.getByRole("menuitem", { name: "New branch here…" })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Cherry-pick 3 commits onto main" }).click();
  await expect(toastText(page, "Cherry-picked 3 commits onto main")).toBeVisible();

  await row(page, "Stage selected lines").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Save as patches…" }).click();
  await expect(toastText(page, "Saved 3 patches")).toBeVisible();

  // Right-clicking outside the selection is a menu for that commit alone.
  await row(page, "Make edge width configurable").click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "New branch here…" })).toBeVisible();
  await expect(selectedRows(page)).toHaveCount(1);
});
