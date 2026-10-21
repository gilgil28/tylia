// Screenshot pipeline (docs/ARCHITECTURE.md §5.7). Not a pass/fail visual diff: it writes
// PNGs to e2e/__screenshots__/ for review against the DESIGN.md checklist. Browser mode
// serves the demo repository fixture (`pnpm fixture`).

import { expect, test, type Page } from "@playwright/test";

const THEMES = ["light", "dark"] as const;
const SIZES = [
  { name: "1280x800", width: 1280, height: 800 },
  { name: "1920x1080", width: 1920, height: 1080 },
  { name: "900x600", width: 900, height: 600 },
] as const;
const PLATFORM = process.env.SHOTS_PLATFORM ?? "windows";

const shot = (page: Page, name: string) =>
  page.screenshot({ path: `e2e/__screenshots__/${name}.png`, animations: "disabled" });

async function open(page: Page, theme: string, query = "", hash = "") {
  // Each test starts from the default UI state.
  await page.addInitScript(() => localStorage.removeItem("tylia.web.ui"));
  await page.goto(`/?theme=${theme}&platform=${PLATFORM}${query}${hash}`);
  await page.evaluate(() => document.fonts.ready);
}

const openDemo = (page: Page, theme: string) => open(page, theme, "&repo=demo");

for (const theme of THEMES) {
  test.describe(theme, () => {
    for (const size of SIZES) {
      test(`welcome ${size.name}`, async ({ page }) => {
        await page.setViewportSize(size);
        await open(page, theme);
        await expect(page.getByText("tylia-demo", { exact: true })).toBeVisible();
        await expect(page.getByText(/^Git \d/)).toBeVisible();
        await shot(page, `welcome-${theme}-${size.name}`);
      });

      test(`repo ${size.name}`, async ({ page }) => {
        await page.setViewportSize(size);
        await openDemo(page, theme);
        await expect(page.getByText("Make edge width configurable").first()).toBeVisible();
        // Select a commit with a code change so the diff shows highlighting.
        await page.getByText("Make edge width configurable").first().click();
        await expect(
          page.getByRole("heading", { name: "Make edge width configurable" }),
        ).toBeVisible();
        await page.waitForTimeout(400);
        await shot(page, `repo-${theme}-${size.name}`);
      });
    }

    test("uncommitted changes, split diff", async ({ page }) => {
      await page.setViewportSize(SIZES[0]);
      await openDemo(page, theme);
      await page.getByText("Uncommitted changes").click();
      await expect(page.getByText("Unstaged · 2")).toBeVisible();
      await page.getByRole("radio", { name: "Side by side" }).click();
      await page.waitForTimeout(400);
      await shot(page, `repo-uncommitted-split-${theme}`);
    });

    test("changes view", async ({ page }) => {
      await page.setViewportSize(SIZES[0]);
      await openDemo(page, theme);
      await page.getByRole("button", { name: /^Changes/ }).click();
      await expect(page.getByText("Unstaged · 2")).toBeVisible();
      await page
        .getByRole("textbox", { name: "Commit message" })
        .fill("Parse records from git log -z");
      await page.waitForTimeout(400);
      await shot(page, `changes-${theme}`);
      await page.getByRole("option", { name: /parser\.rs/ }).click({ button: "right" });
      await expect(page.getByRole("menuitem", { name: "Discard changes…" })).toBeVisible();
      await shot(page, `changes-menu-${theme}`);
      await page.keyboard.press("Escape");
      await page.getByRole("option", { name: /parser\.rs/ }).click();
      await page.keyboard.press("Delete");
      await expect(page.getByRole("dialog", { name: "Discard changes?" })).toBeVisible();
      await shot(page, `changes-discard-${theme}`);
    });

    test("search", async ({ page }) => {
      await page.setViewportSize(SIZES[0]);
      await openDemo(page, theme);
      await page.getByRole("textbox", { name: "Search history" }).fill("lane");
      await expect(page.getByText(/\d+ commits?$/)).toBeVisible();
      await shot(page, `repo-search-${theme}`);
    });

    test("clone dialog", async ({ page }) => {
      await page.setViewportSize(SIZES[0]);
      await open(page, theme);
      await page.getByRole("button", { name: /Clone repository/ }).click();
      await page.getByLabel("Repository URL").fill("https://github.com/tylia-dev/tylia.git");
      await shot(page, `clone-${theme}`);
      await page.getByRole("button", { name: "Clone", exact: true }).click();
      await expect(
        page.getByText(/Receiving objects|Resolving deltas|Counting objects/),
      ).toBeVisible();
      await shot(page, `clone-progress-${theme}`);
    });

    test("history column menu", async ({ page }) => {
      await page.setViewportSize(SIZES[0]);
      await openDemo(page, theme);
      await page.getByRole("columnheader", { name: "Author" }).click({ button: "right" });
      await expect(page.getByRole("menuitemcheckbox", { name: "Hash" })).toBeVisible();
      await shot(page, `repo-columns-menu-${theme}`);
    });

    test("gallery", async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await open(page, theme, "", "#/gallery");
      const scroller = page.getByTestId("gallery-scroll");
      await expect(scroller).toBeVisible();
      // Grow the viewport to the full content height so one image shows every component.
      const height = await scroller.evaluate((el) => el.scrollHeight + 38 + 44);
      await page.setViewportSize({ width: 1280, height });
      await shot(page, `gallery-${theme}`);
    });

    test("gallery overlays", async ({ page }) => {
      await page.setViewportSize(SIZES[0]);
      await open(page, theme, "", "#/gallery");

      const menuButton = page.getByRole("button", { name: "Branch actions" });
      await menuButton.scrollIntoViewIfNeeded();
      await menuButton.click();
      await page.getByRole("menuitem", { name: "Copy" }).hover();
      await expect(page.getByRole("menuitem", { name: "Commit hash" })).toBeVisible();
      await shot(page, `gallery-menu-${theme}`);
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");

      await page.getByText("Right-click here").click({ button: "right" });
      await expect(page.getByRole("menuitem", { name: "Copy path" })).toBeVisible();
      await shot(page, `gallery-context-menu-${theme}`);
      await page.keyboard.press("Escape");

      await page.getByRole("button", { name: "Open dialog" }).click();
      await expect(page.getByRole("dialog", { name: "Create branch" })).toBeVisible();
      await shot(page, `gallery-dialog-${theme}`);
      await page.keyboard.press("Escape");

      await page.getByRole("button", { name: "Discard…" }).click();
      await expect(page.getByRole("dialog", { name: "Discard changes?" })).toBeVisible();
      await shot(page, `gallery-confirm-${theme}`);
      await page.keyboard.press("Escape");

      await page.getByRole("button", { name: "Error", exact: true }).click();
      await page.getByRole("button", { name: "Details" }).click();
      await page.getByRole("button", { name: "Success", exact: true }).click();
      await expect(page.getByText("Pushed to origin/main", { exact: true })).toBeVisible();
      await shot(page, `gallery-toasts-${theme}`);
    });
  });
}
