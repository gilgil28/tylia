// Git LFS against the mock (`?lfs=1`: the demo stores *.md and *.ts with LFS;
// `?lfs=missing`: it uses LFS but Git LFS isn't installed).

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const shot = (page: Page, name: string) =>
  page.screenshot({ path: `e2e/__screenshots__/${name}.png`, animations: "disabled" });

async function openDemo(page: Page, query = "&lfs=1", theme = "light") {
  await page.addInitScript(() => {
    localStorage.removeItem("tylia.web.ui");
    localStorage.removeItem("tylia.web.settings");
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/?theme=${theme}&platform=windows&repo=demo${query}`);
  await expect(page.getByText("Make edge width configurable").first()).toBeVisible();
}

const toastText = (page: Page, text: string | RegExp) => page.getByText(text).first();

test("LFS files are marked in Changes and in a commit's files", async ({ page }) => {
  await openDemo(page);
  // This commit changes src/graph/render.ts.
  await page.getByRole("row").filter({ hasText: "Make edge width configurable" }).first().click();
  await expect(page.getByTitle("Stored with Git LFS").first()).toBeVisible();
  await page
    .getByRole("button", { name: /^Changes/ })
    .first()
    .click();
  const unstaged = page.getByRole("listbox", { name: "Unstaged", exact: true });
  await expect(
    unstaged.getByRole("option", { name: /notes\.md/ }).getByTitle("Stored with Git LFS"),
  ).toBeVisible();
  await expect(
    unstaged.getByRole("option", { name: /parser\.rs/ }).getByTitle("Stored with Git LFS"),
  ).toHaveCount(0);
});

test("the toolbar's LFS menu pulls the objects", async ({ page }) => {
  await openDemo(page);
  await page.getByRole("button", { name: "Git LFS" }).click();
  await page.getByRole("menuitem", { name: "Pull LFS files" }).click();
  await expect(toastText(page, "LFS files are up to date")).toBeVisible();
});

for (const theme of ["light", "dark"]) {
  test(`the locks dialog lists yours and others' (${theme})`, async ({ page }) => {
    await openDemo(page, "&lfs=1", theme);
    await page.getByRole("button", { name: "Git LFS" }).click();
    await page.getByRole("menuitem", { name: "Locks…" }).click();
    const dialog = page.getByRole("dialog", { name: "Git LFS locks" });
    await expect(dialog.getByText("notes.md")).toBeVisible();
    await expect(dialog.getByText("assets/logo.psd")).toBeVisible();
    await expect(dialog.getByText(/^Sam Okafor ·/)).toBeVisible();
    // Only your own locks can be released.
    await expect(dialog.getByRole("button", { name: "Unlock" })).toHaveCount(1);
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .disableRules(["aria-hidden-focus"])
      .analyze();
    expect(axe.violations.map((v) => v.id)).toEqual([]);
    await shot(page, `lfs-locks-${theme}`);
    await dialog.getByRole("button", { name: "Unlock" }).click();
    await expect(toastText(page, "Unlocked notes.md")).toBeVisible();
  });
}

test("a file's menu tracks it or its extension with LFS", async ({ page }) => {
  await openDemo(page);
  await page
    .getByRole("button", { name: /^Changes/ })
    .first()
    .click();
  await page
    .getByRole("listbox", { name: "Unstaged", exact: true })
    .getByRole("option", { name: /parser\.rs/ })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Git LFS" }).click();
  await page.getByRole("menuitem", { name: "Track all *.rs files with LFS" }).click();
  await expect(toastText(page, "Git LFS tracks *.rs from now on")).toBeVisible();
});

test("without Git LFS the badge warns and its actions are off", async ({ page }) => {
  await openDemo(page, "&lfs=missing");
  await page.getByRole("button", { name: "Git LFS" }).click();
  await expect(page.getByText(/Git LFS isn’t installed/).first()).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Pull LFS files" })).toBeDisabled();
});
