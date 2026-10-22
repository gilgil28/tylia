// Custom actions (Settings → Actions) against the mock: editing them, running them from
// menus and the palette, the confirmation, the output panel and Stop
// (`?action=fail|missing|slow` simulates other programs).

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const shot = (page: Page, name: string) =>
  page.screenshot({ path: `e2e/__screenshots__/${name}.png`, animations: "disabled" });

const SHOW_STAT = {
  id: "stat",
  name: "Show stat",
  program: "git",
  arguments: "show --stat {sha}",
  scope: "commit",
  confirm: false,
  showOutput: true,
};

async function openDemo(
  page: Page,
  { query = "", theme = "light", actions = [] as object[] } = {},
) {
  await page.addInitScript((customActions) => {
    localStorage.removeItem("tylia.web.ui");
    localStorage.setItem("tylia.web.settings", JSON.stringify({ customActions }));
  }, actions);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/?theme=${theme}&platform=windows&repo=demo${query}`);
  await expect(page.getByText("Make edge width configurable").first()).toBeVisible();
}

async function commitMenu(page: Page) {
  await page
    .getByRole("row")
    .filter({ hasText: "Make edge width configurable" })
    .first()
    .click({ button: "right" });
}

const toastText = (page: Page, text: string | RegExp) => page.getByText(text).first();

for (const theme of ["light", "dark"]) {
  test(`Settings → Actions adds and edits an action (${theme})`, async ({ page }) => {
    await openDemo(page, { theme });
    await page.keyboard.press("Control+,");
    const settings = page.getByRole("dialog", { name: "Settings" });
    await settings.getByRole("button", { name: "Actions" }).click();
    await expect(settings.getByText("No actions yet.")).toBeVisible();
    await settings.getByRole("button", { name: "Add action" }).click();
    await settings.getByLabel("Name").fill("Lint file");
    await settings.getByLabel("Program").fill("cargo");
    await settings.getByLabel("Arguments").fill("clippy -- {file}");
    await settings.getByLabel("Arguments").press("Enter");
    await settings.getByLabel("Appears in").click();
    await page.getByRole("option", { name: "File menus" }).click();
    await expect(settings.getByLabel("Appears in")).toHaveText(/File menus/);
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .disableRules(["aria-hidden-focus"])
      .analyze();
    expect(axe.violations.map((v) => v.id)).toEqual([]);
    await shot(page, `settings-actions-${theme}`);
    const saved = await page.evaluate(() => localStorage.getItem("tylia.web.settings"));
    expect(JSON.parse(saved!).customActions).toEqual([
      expect.objectContaining({
        name: "Lint file",
        program: "cargo",
        arguments: "clippy -- {file}",
        scope: "file",
        confirm: true,
        showOutput: true,
      }),
    ]);
  });
}

for (const theme of ["light", "dark"]) {
  test(`a commit action shows its output (${theme})`, async ({ page }) => {
    await openDemo(page, { theme, actions: [SHOW_STAT] });
    await commitMenu(page);
    await page.getByRole("menuitem", { name: "Show stat" }).click();
    const output = page.getByRole("dialog", { name: "Show stat" });
    await expect(output.getByText("Exited with code 0")).toBeVisible();
    await expect(output.getByText(/^git show --stat 66c71f7/)).toBeVisible();
    await expect(output.getByText("Checked 42 files: no problems.")).toBeVisible();
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .disableRules(["aria-hidden-focus"])
      .analyze();
    expect(axe.violations.map((v) => v.id)).toEqual([]);
    await shot(page, `custom-action-output-${theme}`);
    await output.getByRole("button", { name: "Close" }).last().click();
    await expect(output).toBeHidden();
  });
}

test("ask before running shows the command line first", async ({ page }) => {
  await openDemo(page, { actions: [{ ...SHOW_STAT, confirm: true }] });
  await commitMenu(page);
  await page.getByRole("menuitem", { name: "Show stat" }).click();
  const confirm = page.getByRole("dialog", { name: "Run Show stat?" });
  await expect(confirm.getByText(/^git show --stat 66c71f7/)).toBeVisible();
  await confirm.getByRole("button", { name: "Run" }).click();
  await expect(
    page.getByRole("dialog", { name: "Show stat" }).getByText("Exited with code 0"),
  ).toBeVisible();
});

test("a failing program shows its errors, a missing one says so", async ({ page }) => {
  await openDemo(page, { query: "&action=fail", actions: [SHOW_STAT] });
  await commitMenu(page);
  await page.getByRole("menuitem", { name: "Show stat" }).click();
  const output = page.getByRole("dialog", { name: "Show stat" });
  await expect(output.getByText("Exited with code 1")).toBeVisible();
  await expect(output.getByText(/expected `;`/)).toBeVisible();

  await openDemo(page, { query: "&action=missing", actions: [SHOW_STAT] });
  await commitMenu(page);
  await page.getByRole("menuitem", { name: "Show stat" }).click();
  await expect(
    page.getByRole("dialog", { name: "Show stat" }).getByText(/git wasn’t found|git wasn't found/),
  ).toBeVisible();
});

test("Stop ends a long-running action", async ({ page }) => {
  await openDemo(page, { query: "&action=slow", actions: [SHOW_STAT] });
  await commitMenu(page);
  await page.getByRole("menuitem", { name: "Show stat" }).click();
  const output = page.getByRole("dialog", { name: "Show stat" });
  await expect(output.getByText("Running…")).toBeVisible();
  await output.getByRole("button", { name: "Stop" }).click();
  await expect(output.getByText("Stopped.")).toBeVisible();
});

test("palette and file menus run actions for their scope", async ({ page }) => {
  await openDemo(page, {
    actions: [
      {
        ...SHOW_STAT,
        id: "fetch-all",
        name: "Fetch everything",
        arguments: "fetch --all",
        scope: "repository",
        showOutput: false,
      },
      {
        ...SHOW_STAT,
        id: "blame",
        name: "Blame in terminal",
        arguments: "blame -- {files}",
        scope: "file",
        showOutput: false,
      },
    ],
  });
  await page.keyboard.press("Control+K");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await palette.getByRole("combobox").fill("fetch everything");
  await palette.getByRole("combobox").press("Enter");
  await expect(toastText(page, "Started Fetch everything")).toBeVisible();

  await page
    .getByRole("button", { name: /^Changes/ })
    .first()
    .click();
  await page
    .getByRole("listbox", { name: "Unstaged" })
    .getByRole("option")
    .first()
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Blame in terminal" }).click();
  await expect(toastText(page, "Started Blame in terminal")).toBeVisible();
  // Commit actions aren't in file menus.
  await expect(page.getByRole("menuitem", { name: "Show stat" })).toHaveCount(0);
});
