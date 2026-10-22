// Patch files against the mock: save a commit or changes, preview and apply a patch
// (`?patch=threeWay|fails|diff` simulates other files, `?save=cancel` a closed save dialog).

import { expect, test, type Page } from "@playwright/test";

const shot = (page: Page, name: string) =>
  page.screenshot({ path: `e2e/__screenshots__/${name}.png`, animations: "disabled" });

async function openDemo(page: Page, query = "", theme = "light") {
  await page.addInitScript(() => {
    localStorage.removeItem("tylia.web.ui");
    localStorage.removeItem("tylia.web.settings");
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/?theme=${theme}&platform=windows&repo=demo${query}`);
  await expect(page.getByText("Make edge width configurable").first()).toBeVisible();
}

const toastText = (page: Page, text: string | RegExp) => page.getByText(text).first();

async function applyFromPalette(page: Page) {
  await page.keyboard.press("Control+K");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await palette.getByRole("combobox").fill("apply patch");
  await palette.getByRole("combobox").press("Enter");
  return page.getByRole("dialog", { name: "Apply patch" });
}

test("a commit's context menu saves it as a patch", async ({ page }) => {
  await openDemo(page);
  await page
    .getByRole("row")
    .filter({ hasText: "Make edge width configurable" })
    .first()
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Save as patch…" }).click();
  await expect(toastText(page, "Patch saved")).toBeVisible();
  await expect(toastText(page, "0001-make-edge-width-configurable.patch")).toBeVisible();
});

test("closing the save dialog saves nothing", async ({ page }) => {
  await openDemo(page, "&save=cancel");
  await page
    .getByRole("button", { name: /^Changes/ })
    .first()
    .click();
  await page.getByRole("button", { name: "Save unstaged changes as a patch" }).click();
  await expect(page.getByText("Patch saved")).toHaveCount(0);
});

test("the Changes lists save staged and unstaged changes", async ({ page }) => {
  await openDemo(page);
  await page
    .getByRole("button", { name: /^Changes/ })
    .first()
    .click();
  await page.getByRole("button", { name: "Save staged changes as a patch" }).click();
  await expect(toastText(page, /tylia-demo-staged\.patch/)).toBeVisible();
});

for (const theme of ["light", "dark"]) {
  test(`applying a mailbox creates its commits (${theme})`, async ({ page }) => {
    await openDemo(page, "", theme);
    const dialog = await applyFromPalette(page);
    await expect(dialog.getByText("0001-parser-handle-empty-input.patch")).toBeVisible();
    await expect(dialog.getByText("Applies cleanly.")).toBeVisible();
    await expect(dialog.getByText("parser: test empty input")).toBeVisible();
    await expect(dialog.getByText("tests/parse.rs → tests/parser.rs")).toBeVisible();
    await expect(dialog.getByText("binary")).toBeVisible();
    await shot(page, `patch-apply-${theme}`);
    await dialog.getByRole("button", { name: "Create 2 commits" }).click();
    await expect(toastText(page, "Created 2 commits on main")).toBeVisible();
    await expect(dialog).toBeHidden();
  });
}

test("a patch that needs a merge says so, one that fails can't be applied", async ({ page }) => {
  await openDemo(page, "&patch=threeWay", "dark");
  let dialog = await applyFromPalette(page);
  await expect(dialog.getByText(/A three-way merge will try/)).toBeVisible();
  await expect(dialog.getByText(/patch does not apply/)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Create 2 commits" })).toBeEnabled();
  await shot(page, "patch-apply-threeway-dark");
  await dialog.getByRole("button", { name: "Cancel" }).click();

  await openDemo(page, "&patch=fails");
  dialog = await applyFromPalette(page);
  await expect(dialog.getByText(/Doesn’t apply to this repository/)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Create 2 commits" })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Apply to working copy" })).toBeDisabled();
});

test("a plain diff goes to the working copy", async ({ page }) => {
  await openDemo(page, "&patch=diff");
  const dialog = await applyFromPalette(page);
  await expect(dialog.getByRole("button", { name: "Apply to working copy" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(toastText(page, "Patch applied to the working copy")).toBeVisible();
});

for (const theme of ["light", "dark"]) {
  test(`git am stopped on conflicts shows the banner (${theme})`, async ({ page }) => {
    await page.addInitScript(() => {
      (window as Window & { __tyliaBranching?: object }).__tyliaBranching = {
        applyPatch: "conflicts",
      };
    });
    await openDemo(page, "", theme);
    const dialog = await applyFromPalette(page);
    await dialog.getByRole("button", { name: "Create 2 commits" }).click();
    await expect(toastText(page, "Applying the patch stopped on conflicts")).toBeVisible();
    await expect(
      page.getByText("Applying “parser: handle empty input” to main · patch 1 of 2"),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Skip patch" })).toBeVisible();
    await shot(page, `patch-am-banner-${theme}`);
    await page.getByRole("button", { name: "Abort" }).click();
    await expect(page.getByRole("dialog", { name: "Abort the patch?" })).toBeVisible();
  });
}
