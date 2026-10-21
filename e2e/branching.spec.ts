// Branches, tags, stashes, merge / rebase / reset and conflicts against the mock backend.
// Outcomes are scripted through `window.__tyliaBranching` (src/ipc/mock/branching.ts). Also
// writes screenshots for review against docs/DESIGN.md §4.13.

import { expect, test, type Page } from "@playwright/test";

type Script = Record<string, unknown>;

const shot = (page: Page, name: string) =>
  page.screenshot({ path: `e2e/__screenshots__/${name}.png`, animations: "disabled" });

async function openDemo(page: Page, { theme = "light", script = {} as Script } = {}) {
  await page.addInitScript((s) => {
    localStorage.removeItem("tylia.web.ui");
    localStorage.removeItem("tylia.web.settings");
    (window as Window & { __tyliaBranching?: Script }).__tyliaBranching = s;
  }, script);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/?theme=${theme}&platform=windows&repo=demo`);
  await expect(page.getByText("Make edge width configurable").first()).toBeVisible();
}

/** Toast text (Radix also renders an aria-live copy). */
const toastText = (page: Page, text: string | RegExp) => page.getByText(text).first();

const row = (page: Page, subject: string) =>
  page.getByRole("row").filter({ hasText: subject }).first();

test("new branch from a commit's context menu", async ({ page }) => {
  await openDemo(page);
  await row(page, "Make edge width configurable").click({ button: "right" });
  await page.getByRole("menuitem", { name: "New branch here…" }).click();
  const dialog = page.getByRole("dialog", { name: "New branch" });
  await expect(dialog.getByLabel("Name")).toBeFocused();
  await dialog.getByLabel("Name").fill("feature/graph");
  await expect(dialog.getByText("A branch with this name already exists")).toBeVisible();
  await dialog.getByLabel("Name").fill("fix/edges");
  await dialog.getByRole("button", { name: "Create branch" }).click();
  await expect(toastText(page, "Created and switched to fix/edges")).toBeVisible();
  await expect(page.getByRole("button", { name: /Current branch fix\/edges/ })).toBeVisible();
});

test("switch branches from the toolbar", async ({ page }) => {
  await openDemo(page);
  await page.getByRole("button", { name: /Current branch main/ }).click();
  await page.getByPlaceholder("Switch to branch…").fill("pars");
  await page.waitForTimeout(100);
  await shot(page, "branching-switcher-light");
  await page.getByPlaceholder("Switch to branch…").press("Enter");
  await expect(toastText(page, "Switched to feature/parser")).toBeVisible();
});

test("checkout refused by local changes offers stash and switch", async ({ page }) => {
  await openDemo(page, { script: { checkout: "localChanges" } });
  await page.getByRole("tree", { name: "Branches" }).getByText("parser").dblclick();
  const dialog = page.getByRole("dialog", { name: "Your changes would be overwritten" });
  await expect(dialog.getByText("src/parser.rs")).toBeVisible();
  await dialog.getByRole("button", { name: "Stash and switch" }).click();
  await expect(toastText(page, "Switched to feature/parser")).toBeVisible();
});

test("deleting an unmerged branch asks again", async ({ page }) => {
  await openDemo(page, { script: { deleteBranch: "notFullyMerged" } });
  await page.getByRole("tree", { name: "Branches" }).getByText("parser").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete branch…" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete branch" }).click();
  const again = page.getByRole("dialog", { name: "feature/parser isn’t merged" });
  await expect(again).toBeVisible();
  await expect(again.getByRole("button", { name: "Cancel" })).toBeFocused();
  await again.getByRole("button", { name: "Delete anyway" }).click();
  await expect(toastText(page, "Deleted branch feature/parser")).toBeVisible();
  await expect(page.getByRole("tree", { name: "Branches" }).getByText("parser")).toHaveCount(0);
});

for (const theme of ["light", "dark"]) {
  test(`merge conflicts: banner, resolve, commit merge (${theme})`, async ({ page }) => {
    await openDemo(page, { theme, script: { merge: "conflicts" } });
    await page
      .getByRole("tree", { name: "Branches" })
      .getByText("parser")
      .click({ button: "right" });
    await page.getByRole("menuitem", { name: "Merge feature/parser into main" }).click();
    await expect(toastText(page, "Merge stopped on conflicts")).toBeVisible();
    const banner = page.getByRole("status").filter({ hasText: "Merging feature/parser into main" });
    await expect(banner).toContainText("1 conflict");
    await expect(banner.getByRole("button", { name: "Commit merge" })).toBeDisabled();
    await banner.getByRole("button", { name: "Show conflicts" }).click();
    await page.getByRole("option", { name: /conflict\.rs/ }).click();
    await page.waitForTimeout(300);
    await shot(page, `branching-conflicts-${theme}`);
    await page.getByRole("button", { name: "Use my version" }).click();
    await expect(banner).toContainText("All conflicts resolved");
    await banner.getByRole("button", { name: "Commit merge" }).click();
    await expect(banner).toHaveCount(0);
  });
}

for (const theme of ["light", "dark"]) {
  test(`resolve conflict blocks one at a time (${theme})`, async ({ page }) => {
    await openDemo(page, { theme, script: { merge: "conflicts" } });
    await page
      .getByRole("tree", { name: "Branches" })
      .getByText("parser")
      .click({ button: "right" });
    await page.getByRole("menuitem", { name: "Merge feature/parser into main" }).click();
    const banner = page.getByRole("status").filter({ hasText: "Merging" });
    await banner.getByRole("button", { name: "Show conflicts" }).click();
    const first = page.getByRole("region", { name: "Conflict 1 of 2" });
    await expect(first).toContainText("lex(input.trim())");
    await expect(page.getByRole("region", { name: "Conflict 2 of 2" })).toBeVisible();
    await page.waitForTimeout(300);
    await shot(page, `branching-blocks-${theme}`);

    await first.getByRole("button", { name: "Use theirs" }).click();
    const last = page.getByRole("region", { name: "Conflict 1 of 1" });
    await expect(last).toContainText("take_while");
    // The resolved block is now plain text (with their version), folded into unchanged lines.
    await page
      .getByRole("button", { name: /unchanged lines/ })
      .first()
      .click();
    await expect(page.getByText("let tokens = lex(input.trim());")).toBeVisible();
    await last.getByRole("button", { name: "Use both" }).click();
    await expect(toastText(page, "conflict.rs resolved")).toBeVisible();
    await expect(banner).toContainText("All conflicts resolved");
  });
}

test("conflicts show even when they are the only changes", async ({ page }) => {
  await openDemo(page, { script: { merge: "conflicts" } });
  // Stash everything first, so the merge's conflict is the only change.
  await page.getByRole("button", { name: "Stash", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Stash", exact: true }).click();
  await expect(toastText(page, "Stashed your changes")).toBeVisible();
  await page.getByRole("tree", { name: "Branches" }).getByText("parser").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Merge feature/parser into main" }).click();
  await page.getByRole("status").getByRole("button", { name: "Show conflicts" }).click();
  await expect(page.getByRole("option", { name: /conflict\.rs/ })).toBeVisible();
  await expect(page.getByText("No changes", { exact: true })).toHaveCount(0);
});

test("merge without fast-forward from the merge options", async ({ page }) => {
  await openDemo(page);
  await page.getByRole("tree", { name: "Branches" }).getByText("parser").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Merge options" }).click();
  await page.getByRole("menuitem", { name: "Always create a merge commit" }).click();
  await expect(toastText(page, "Merged feature/parser into main")).toBeVisible();
});

test("abort asks first and says what is lost", async ({ page }) => {
  await openDemo(page, { script: { rebase: "conflicts" } });
  await row(page, "Stage selected lines").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rebase main onto this commit…" }).click();
  const confirm = page.getByRole("dialog", { name: /Rebase main onto/ });
  await expect(confirm.getByText(/get new ids/)).toBeVisible();
  await confirm.getByRole("button", { name: "Rebase" }).click();
  const banner = page.getByRole("status").filter({ hasText: "Rebasing main onto" });
  await expect(banner).toContainText("commit 1 of 3");
  await banner.getByRole("button", { name: "Abort" }).click();
  const abort = page.getByRole("dialog", { name: "Abort the rebase?" });
  await expect(abort.getByText(/conflict resolutions made so far are lost/)).toBeVisible();
  await abort.getByRole("button", { name: "Abort rebase" }).click();
  await expect(banner).toHaveCount(0);
});

test("hard reset confirms with the number of files lost", async ({ page }) => {
  await openDemo(page);
  await row(page, "Stage selected lines").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Reset main to this commit…" }).click();
  const dialog = page.getByRole("dialog", { name: "Reset main" });
  await dialog.getByRole("radio", { name: /Hard/ }).click();
  await expect(dialog.getByText(/uncommitted changes in 2 files/)).toBeVisible();
  await shot(page, "branching-reset-light");
  await dialog.getByRole("button", { name: "Reset…" }).click();
  const confirm = page.getByRole("dialog", { name: "Hard reset main?" });
  await expect(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
  await confirm.getByRole("button", { name: "Discard and reset" }).click();
  await expect(toastText(page, /Reset main to/)).toBeVisible();
});

test("stash from the toolbar, then pop it from the sidebar", async ({ page }) => {
  await openDemo(page);
  await page.getByRole("button", { name: "Stash", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Stash changes" });
  await dialog.getByLabel("Message").fill("half-done parser");
  await dialog.getByRole("button", { name: "Stash", exact: true }).click();
  await expect(toastText(page, "Stashed your changes")).toBeVisible();
  const sidebar = page.getByRole("navigation");
  await sidebar.getByText("Stashes", { exact: true }).click();
  await sidebar.getByText("On main: half-done parser").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Pop (apply and remove)" }).click();
  await expect(toastText(page, "Applied and removed the stash")).toBeVisible();
  await expect(sidebar.getByText("On main: half-done parser")).toHaveCount(0);
});

test("tags: create on a commit, then delete", async ({ page }) => {
  await openDemo(page);
  await row(page, "Make edge width configurable").click({ button: "right" });
  await page.getByRole("menuitem", { name: "New tag here…" }).click();
  const dialog = page.getByRole("dialog", { name: "New tag" });
  await dialog.getByLabel("Name").fill("v0.2.0");
  await dialog.getByLabel("Message").fill("Second release");
  await dialog.getByRole("button", { name: "Create tag" }).click();
  await expect(toastText(page, "Created tag v0.2.0")).toBeVisible();
  const sidebar = page.getByRole("navigation");
  await sidebar.getByText("Tags", { exact: true }).click();
  await sidebar.getByText("v0.2.0").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete tag…" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete tag" }).click();
  await expect(toastText(page, "Deleted tag v0.2.0")).toBeVisible();
});

test("drag a branch badge onto the current branch to merge", async ({ page }) => {
  await openDemo(page);
  const badge = page.locator('[data-ref-name="feature/line-staging"]').first();
  const target = row(page, "Parse commit trailers");
  const from = (await badge.boundingBox())!;
  const to = (await target.boundingBox())!;
  await page.mouse.move(from.x + 10, from.y + 5);
  await page.mouse.down();
  await page.mouse.move(from.x + 30, from.y - 20, { steps: 4 });
  await page.mouse.move(to.x + 300, to.y + to.height / 2, { steps: 6 });
  await expect(page.getByText("Merge or rebase with feature/line-staging…")).toBeVisible();
  await page.mouse.up();
  await page.getByRole("menuitem", { name: "Merge feature/line-staging into main" }).click();
  await expect(toastText(page, "Merged feature/line-staging into main")).toBeVisible();
});

test("merge tool without one configured explains how", async ({ page }) => {
  await openDemo(page, { script: { cherryPick: "conflicts" } });
  await row(page, "Stage selected lines").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Cherry-pick onto main" }).click();
  await page.getByRole("status").getByRole("button", { name: "Show conflicts" }).click();
  await page.getByRole("option", { name: /conflict\.rs/ }).click();
  await page.getByRole("button", { name: "Open merge tool" }).click();
  await expect(toastText(page, "Couldn’t open the merge tool")).toBeVisible();
  await expect(toastText(page, /No merge tool is configured/)).toBeVisible();
});
