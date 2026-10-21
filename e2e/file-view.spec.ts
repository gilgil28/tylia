// File history ("Log selected…") and blame against the mock backend (src/ipc/mock/
// file-view.ts). Also writes screenshots for review against docs/DESIGN.md §4.13.

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const shot = (page: Page, name: string) =>
  page.screenshot({ path: `e2e/__screenshots__/${name}.png`, animations: "disabled" });

async function openDemo(page: Page, { theme = "light", size = { width: 1280, height: 800 } } = {}) {
  await page.addInitScript(() => {
    localStorage.removeItem("tylia.web.ui");
    localStorage.removeItem("tylia.web.settings");
  });
  await page.setViewportSize(size);
  await page.goto(`/?theme=${theme}&platform=windows&repo=demo`);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.getByText("Make edge width configurable").first()).toBeVisible();
}

/** WCAG 2.1 A/AA violations, formatted for a readable failure message. */
async function violations(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  return result.violations.map(
    (v) => `${v.id}: ${v.help} at ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
  );
}

const fileView = (page: Page) => page.getByRole("region", { name: "src/parser.rs", exact: true });
const historyList = (page: Page) =>
  page.getByRole("listbox", { name: "Commits that changed src/parser.rs" });
const blameLines = (page: Page) => page.getByRole("listbox", { name: "Blame of src/parser.rs" });

for (const theme of ["light", "dark"]) {
  test(`file history from a commit's file list (${theme})`, async ({ page }) => {
    await openDemo(page, { theme });
    // The newest commit is selected and its only file is shown.
    await expect(page.getByRole("heading", { name: "Parse commit trailers" })).toBeVisible();
    await page
      .getByRole("listbox", { name: "Changed files" })
      .getByText("parser.rs")
      .click({ button: "right" });
    await page.getByRole("menuitem", { name: "Show history" }).click();

    await expect(fileView(page)).toBeVisible();
    await expect(page.getByRole("radio", { name: "History" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    const list = historyList(page);
    await expect(list.getByRole("option")).toHaveCount(12);
    await expect(list.getByRole("option").first()).toContainText("Parse commit trailers");
    // The oldest entry is the (demo) rename.
    await expect(list.getByText("Renamed from src/parse.rs")).toBeVisible();
    await expect(list).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(list.getByRole("option").nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("region", { name: "Changes in src/parser.rs" })).toBeVisible();
    await page.waitForTimeout(400);
    await shot(page, `file-history-${theme}`);

    await list.getByRole("option").last().click();
    await expect(page.getByText("parse.rs", { exact: true })).toBeVisible();
    await shot(page, `file-history-rename-${theme}`);

    // Back to History, with the commit and its file still selected.
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByRole("heading", { name: "Parse commit trailers" })).toBeVisible();
  });

  test(`blame of the working copy (${theme})`, async ({ page }) => {
    await openDemo(page, { theme });
    await page.getByRole("button", { name: /^Changes/ }).click();
    await page.getByRole("option", { name: /parser\.rs/ }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Blame" }).click();

    const lines = blameLines(page);
    await expect(lines).toBeFocused();
    await expect(lines.getByText("Not committed yet", { exact: true })).toBeVisible();
    await expect(lines.getByText("//! Parses `git log -z` records.")).toBeVisible();
    await expect(lines.getByText("pub fn parse_trailers(input: &str) -> usize {")).toHaveCount(0);
    await expect(lines.getByRole("option")).not.toHaveCount(0);
    // Syntax highlighting arrives from the worker.
    await page.waitForTimeout(600);
    await shot(page, `blame-${theme}`);

    // Hovering a commit shows its summary.
    await lines.getByText("Ada Moreno", { exact: true }).first().hover();
    await expect(page.getByRole("tooltip").getByText("Initial commit")).toBeVisible();
    await shot(page, `blame-tooltip-${theme}`);
  });
}

test("blame the parent, then back to the latest", async ({ page }) => {
  await openDemo(page);
  await page.getByRole("button", { name: /^Changes/ }).click();
  await page.getByRole("option", { name: /parser\.rs/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Blame" }).click();
  const lines = blameLines(page);
  await expect(lines.getByText("Not committed yet", { exact: true })).toBeVisible();

  // Line 4 came from "Strip CR before splitting records".
  await lines.getByRole("option", { name: /^Line 4:/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Blame before this change" }).click();
  await expect(page.getByText(/^at [0-9a-f]{7}$/)).toBeVisible();
  await expect(lines.getByText("Not committed yet", { exact: true })).toHaveCount(0);
  await expect(lines.getByText("//! Parses log records.")).toBeVisible();

  await page.getByRole("button", { name: "Show the latest version" }).click();
  await expect(page.getByText(/^at [0-9a-f]{7}$/)).toHaveCount(0);
  await expect(lines.getByText("Not committed yet", { exact: true })).toBeVisible();

  // History of the same file from the header's switch, then Escape leaves the view.
  await page.getByRole("radio", { name: "History" }).click();
  await expect(historyList(page).getByRole("option")).toHaveCount(12);
  await page.keyboard.press("Escape");
  await expect(page.getByText(/^Unstaged · \d+$/)).toBeVisible();
});

test("keyboard: blame the selected file, reveal a line's commit", async ({ page }) => {
  await openDemo(page);
  await expect(page.getByRole("heading", { name: "Parse commit trailers" })).toBeVisible();
  // The commit's first file is selected; blame it at that commit.
  await page.keyboard.press("Control+Shift+A");
  const lines = blameLines(page);
  await expect(lines).toBeFocused();
  await expect(page.getByText(/^at 199ef74$/)).toBeVisible();
  await expect(lines.getByText("Not committed yet", { exact: true })).toHaveCount(0);

  // Alt+← goes back; the shortcut for history opens the list.
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(page.getByRole("heading", { name: "Parse commit trailers" })).toBeVisible();
  await page.keyboard.press("Control+Shift+H");
  await expect(historyList(page)).toBeFocused();
  await page.getByRole("radio", { name: "Blame" }).click();
  await expect(lines).toBeVisible();

  // Enter on a line shows its commit in History (line 1 is uncommitted, line 2 isn't).
  await lines.focus();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowDown");
  await expect(lines.getByRole("option", { name: /^Line 2:/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Initial commit" })).toBeVisible();
  await expect(fileView(page)).toHaveCount(0);
});

test("diff header opens the file's history and blame", async ({ page }) => {
  await openDemo(page);
  await page.getByText("Make edge width configurable").first().click();
  await page.getByRole("button", { name: "Show file history" }).click();
  await expect(
    page.getByRole("listbox", { name: "Commits that changed src/graph/render.ts" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("button", { name: "Blame file" }).click();
  await expect(page.getByRole("listbox", { name: "Blame of src/graph/render.ts" })).toBeVisible();
});

test("untracked files have no history or blame", async ({ page }) => {
  await openDemo(page);
  await page.getByRole("button", { name: /^Changes/ }).click();
  await page.getByRole("option", { name: /notes\.md/ }).click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Show history" })).toBeDisabled();
  await expect(page.getByRole("menuitem", { name: "Blame" })).toBeDisabled();
});

test("file view at the minimum window size", async ({ page }) => {
  await openDemo(page, { theme: "dark", size: { width: 900, height: 600 } });
  await page.getByRole("button", { name: /^Changes/ }).click();
  await page.getByRole("option", { name: /parser\.rs/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Blame" }).click();
  await expect(blameLines(page).getByText("Not committed yet", { exact: true })).toBeVisible();
  await page.waitForTimeout(500);
  await shot(page, "blame-dark-900x600");
  await page.getByRole("radio", { name: "History" }).click();
  await expect(historyList(page).getByRole("option").first()).toBeVisible();
  await page.waitForTimeout(400);
  await shot(page, "file-history-dark-900x600");
});

for (const theme of ["light", "dark"]) {
  test(`file view passes axe checks (${theme})`, async ({ page }) => {
    await openDemo(page, { theme });
    await page.getByRole("button", { name: /^Changes/ }).click();
    await page.getByRole("option", { name: /parser\.rs/ }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Blame" }).click();
    await expect(blameLines(page).getByText("Not committed yet", { exact: true })).toBeVisible();
    await page.waitForTimeout(400);
    expect(await violations(page)).toEqual([]);
    await page.getByRole("radio", { name: "History" }).click();
    await expect(page.getByRole("region", { name: "Changes in src/parser.rs" })).toBeVisible();
    await page.waitForTimeout(400);
    expect(await violations(page)).toEqual([]);
  });
}
