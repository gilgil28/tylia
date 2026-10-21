// Accessibility checks (axe-core, WCAG 2.1 A/AA rules) on the main screens and dialogs in
// both themes, and a layout check at 200% zoom.

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const shot = (page: Page, name: string) =>
  page.screenshot({ path: `e2e/__screenshots__/${name}.png`, animations: "disabled" });

async function open(page: Page, theme: string, query = "&repo=demo") {
  await page.addInitScript(() => {
    localStorage.removeItem("tylia.web.ui");
    localStorage.removeItem("tylia.web.settings");
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/?theme=${theme}&platform=windows${query}`);
  await page.evaluate(() => document.fonts.ready);
}

/**
 * Violations, formatted for a readable failure message. With an overlay (menu, dialog) open,
 * Radix hides the rest of the page with aria-hidden and traps focus in the overlay, so the
 * page's controls can't be focused; axe's aria-hidden-focus rule can't see the trap.
 */
async function violations(page: Page, { overlay = false } = {}) {
  let builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]);
  if (overlay) builder = builder.disableRules(["aria-hidden-focus"]);
  const result = await builder.analyze();
  return result.violations.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.help}\n` +
      v.nodes
        .slice(0, 5)
        .map((n) => `    ${n.target.join(" ")}  ${n.failureSummary?.split("\n")[1] ?? ""}`)
        .join("\n"),
  );
}

for (const theme of ["light", "dark"]) {
  test.describe(theme, () => {
    test("welcome screen", async ({ page }) => {
      await open(page, theme, "");
      await expect(page.getByText(/^Git \d/)).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test("history with commit details", async ({ page }) => {
      await open(page, theme);
      await expect(page.getByText("Make edge width configurable").first()).toBeVisible();
      await page.waitForTimeout(400);
      expect(await violations(page)).toEqual([]);
    });

    test("changes view", async ({ page }) => {
      await open(page, theme);
      await page.getByText("Uncommitted changes").click();
      await expect(page.getByText(/^Unstaged · /)).toBeVisible();
      await page.waitForTimeout(400);
      expect(await violations(page)).toEqual([]);
    });

    test("command palette", async ({ page }) => {
      await open(page, theme);
      await expect(page.getByText("Make edge width configurable").first()).toBeVisible();
      await page.keyboard.press("Control+K");
      await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
      expect(await violations(page, { overlay: true })).toEqual([]);
    });

    test("settings", async ({ page }) => {
      await open(page, theme);
      await expect(page.getByText("Make edge width configurable").first()).toBeVisible();
      await page.keyboard.press("Control+,");
      const settings = page.getByRole("dialog", { name: "Settings" });
      await expect(settings).toBeVisible();
      expect(await violations(page, { overlay: true })).toEqual([]);
      await settings.getByRole("button", { name: "Keyboard" }).click();
      expect(await violations(page, { overlay: true })).toEqual([]);
    });

    test("a dialog and a context menu", async ({ page }) => {
      await open(page, theme);
      const row = page.getByRole("row").filter({ hasText: "Make edge width configurable" }).first();
      await row.click({ button: "right" });
      await expect(page.getByRole("menuitem", { name: "New branch here…" })).toBeVisible();
      expect(await violations(page, { overlay: true })).toEqual([]);
      await page.getByRole("menuitem", { name: "New branch here…" }).click();
      await expect(page.getByRole("dialog", { name: "New branch" })).toBeVisible();
      expect(await violations(page, { overlay: true })).toEqual([]);
    });
  });
}

test("200% zoom keeps the main controls usable", async ({ page }) => {
  // 200% zoom of a 1280×800 window lays out like a 640×400 one.
  await page.addInitScript(() => localStorage.removeItem("tylia.web.ui"));
  await page.setViewportSize({ width: 640, height: 400 });
  await page.goto(`/?theme=light&platform=windows&repo=demo`);
  await expect(page.getByText("Make edge width configurable").first()).toBeVisible();
  await shot(page, "a11y-zoom-200");
  // Nothing scrolls the whole page sideways, and the toolbar's actions stay reachable.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  for (const name of ["Fetch", "Pull", "Push"]) {
    await expect(
      page.getByRole("button", { name: new RegExp(`^${name}(?! options)`) }).first(),
    ).toBeVisible();
  }
  await page.keyboard.press("Control+K");
  await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
  await shot(page, "a11y-zoom-200-palette");
});
