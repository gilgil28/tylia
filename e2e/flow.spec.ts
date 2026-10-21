// git-flow helpers (toolbar menu, palette, dialogs) against the mock.

import { expect, test, type Page } from "@playwright/test";

const shot = (page: Page, name: string) =>
  page.screenshot({ path: `e2e/__screenshots__/${name}.png`, animations: "disabled" });

async function open(page: Page, query = "", theme = "light") {
  await page.addInitScript(() => {
    localStorage.removeItem("tylia.web.ui");
    localStorage.removeItem("tylia.web.settings");
  });
  await page.setViewportSize({ width: 1440, height: 860 });
  await page.goto(`/?theme=${theme}&platform=windows&repo=demo${query}`);
  await expect(page.getByText("Make edge width configurable").first()).toBeVisible();
}

for (const theme of ["light", "dark"]) {
  test(`set up git-flow from the toolbar (${theme})`, async ({ page }) => {
    await open(page, "", theme);
    await page.getByRole("button", { name: "Git-flow" }).click();
    await expect(page.getByText("git-flow isn’t set up here")).toBeVisible();
    await page.getByRole("menuitem", { name: "Set up git-flow…" }).click();
    const dialog = page.getByRole("dialog", { name: "Set up git-flow" });
    await expect(dialog.getByLabel("Development branch")).toHaveValue("develop");
    await expect(dialog.getByText("Will be created from main.")).toBeVisible();
    await dialog.getByLabel("Version tag prefix").fill("v");
    await shot(page, `flow-setup-${theme}`);
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("git-flow is set up").first()).toBeVisible();

    await page.getByRole("button", { name: "Git-flow" }).click();
    await expect(page.getByRole("menuitem", { name: "Start release…" })).toBeVisible();
  });
}

test("start a feature and finish it", async ({ page }) => {
  await open(page, "&flow=1");
  await page.getByRole("button", { name: "Git-flow" }).click();
  await page.getByRole("menuitem", { name: "Start feature…" }).click();
  const start = page.getByRole("dialog", { name: "Start a feature" });
  await expect(
    start.getByText("Creates the branch from develop and switches to it."),
  ).toBeVisible();
  await start.getByLabel("Feature name").fill("login");
  await expect(start.getByText("Branch: feature/login")).toBeVisible();
  await start.getByRole("button", { name: "Start" }).click();
  await expect(page.getByText("Started feature/login").first()).toBeVisible();

  // The palette offers finishing the current flow branch.
  await page.keyboard.press("Control+K");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await palette.getByRole("combobox").fill("finish feature/login");
  await palette.getByRole("combobox").press("Enter");
  const finish = page.getByRole("dialog", { name: "Finish feature/login" });
  await expect(finish.getByText("Merge feature/login into develop (merge commit)")).toBeVisible();
  await expect(finish.getByText("Delete the local branch feature/login")).toBeVisible();
  await finish.getByRole("button", { name: "Finish" }).click();
  await expect(page.getByText("Finished feature/login").first()).toBeVisible();
});

for (const theme of ["light", "dark"]) {
  test(`finishing a release lists the steps and the tag (${theme})`, async ({ page }) => {
    await open(page, "&flow=1", theme);
    await page.getByRole("button", { name: "Git-flow" }).click();
    await page.getByRole("menuitem", { name: "Start release…" }).click();
    const start = page.getByRole("dialog", { name: "Start a release" });
    await start.getByLabel("Version").fill("1.2.0");
    await start.getByRole("button", { name: "Start" }).click();
    await expect(page.getByText("Started release/1.2.0").first()).toBeVisible();

    await page.getByRole("button", { name: "Git-flow" }).click();
    await page.getByRole("menuitem", { name: "Finish release/1.2.0…" }).click();
    const finish = page.getByRole("dialog", { name: "Finish release/1.2.0" });
    await expect(finish.getByText("Tag the result on main as v1.2.0")).toBeVisible();
    await expect(finish.getByLabel("Message for v1.2.0")).toHaveValue("Release 1.2.0");
    await finish.getByRole("checkbox", { name: "Keep the branch" }).click();
    await expect(finish.getByText("Delete the local branch release/1.2.0")).toHaveCount(0);
    await shot(page, `flow-finish-release-${theme}`);
    await finish.getByRole("button", { name: "Finish" }).click();
    await expect(page.getByText("Merged into main, develop. Tagged v1.2.0.").first()).toBeVisible();
  });
}

test("sidebar branch menu offers Finish on flow branches", async ({ page }) => {
  await open(page, "&flow=1");
  await page.getByRole("button", { name: "Git-flow" }).click();
  await page.getByRole("menuitem", { name: "Start hotfix…" }).click();
  await page.getByRole("dialog", { name: "Start a hotfix" }).getByLabel("Version").fill("1.0.1");
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByText("Started hotfix/1.0.1").first()).toBeVisible();
  await page.getByRole("navigation").getByText("1.0.1", { exact: true }).click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Finish hotfix/1.0.1…" })).toBeVisible();
});
