// Fetch / Pull / Push, the Push dialog and remote management against the mock backend.
// Outcomes are scripted through `window.__tyliaRemote` (src/ipc/mock/remote.ts). Also writes
// screenshots for review against docs/DESIGN.md §4.13.

import { expect, test, type Page } from "@playwright/test";

type Script = Record<string, unknown>;

const shot = (page: Page, name: string) =>
  page.screenshot({ path: `e2e/__screenshots__/${name}.png`, animations: "disabled" });

async function openDemo(page: Page, { theme = "light", script = {} as Script, width = 1280 } = {}) {
  await page.addInitScript((s) => {
    localStorage.removeItem("tylia.web.ui");
    localStorage.removeItem("tylia.web.settings");
    (window as Window & { __tyliaRemote?: Script }).__tyliaRemote = s;
  }, script);
  await page.setViewportSize({ width, height: 800 });
  await page.goto(`/?theme=${theme}&platform=windows&repo=demo`);
  await expect(page.getByText("Make edge width configurable").first()).toBeVisible();
}

/** The main half of a toolbar split button (not "… options"). */
const button = (page: Page, name: string) =>
  page.getByRole("button", { name: new RegExp(`^${name}(?! options)`) }).first();

/** Toast text (Radix also renders an aria-live copy). */
const toastText = (page: Page, text: string | RegExp) => page.getByText(text).first();

test("push sends the branch to its upstream and clears the outgoing count", async ({ page }) => {
  await openDemo(page);
  const push = button(page, "Push");
  await expect(push).toContainText("2");
  await push.click();
  await expect(toastText(page, "Pushed main to origin/main")).toBeVisible();
  await expect(push).not.toContainText("2");
});

test("a rejected push explains why and offers to pull", async ({ page }) => {
  await openDemo(page, { script: { push: "behind" } });
  await button(page, "Push").click();
  await expect(toastText(page, "origin/main has commits that main doesn’t")).toBeVisible();
  await expect(toastText(page, "Pull them first, then push.")).toBeVisible();
  await page.getByRole("button", { name: "Pull", exact: true }).last().click();
  await expect(toastText(page, "main is already up to date")).toBeVisible();
});

test("progress panel shows the phase and cancels", async ({ page }) => {
  await openDemo(page, { script: { stepMs: 400 } });
  const fetch = button(page, "Fetch");
  await fetch.click();
  await expect(fetch).toHaveAttribute("aria-busy", "true");
  // Other operations wait for this one.
  await expect(button(page, "Pull")).toBeDisabled();
  await fetch.click();
  await expect(page.getByText("Fetching from all remotes")).toBeVisible();
  await expect(page.getByText("Counting objects")).toBeVisible();
  await page.waitForTimeout(150);
  await shot(page, "remote-progress-light");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(fetch).toHaveAttribute("aria-busy", "false");
  await expect(page.getByText("Fetch failed")).toHaveCount(0);
});

test("pull mode is chosen from the menu and remembered", async ({ page }) => {
  await openDemo(page);
  await page.getByRole("button", { name: "Pull options" }).click();
  await page.getByRole("menuitemradio", { name: "Rebase" }).click();
  await expect(toastText(page, "main is already up to date")).toBeVisible();
  await button(page, "Pull").hover();
  await expect(page.getByRole("tooltip")).toContainText("(rebase)");
});

test("pull conflicts point to the Changes view", async ({ page }) => {
  await openDemo(page, { script: { pull: "conflicts" } });
  await button(page, "Pull").click();
  await expect(toastText(page, "Pull stopped on conflicts")).toBeVisible();
  await page.getByRole("button", { name: "Show changes" }).click();
  await expect(page.getByText(/^Unstaged · /)).toBeVisible();
});

for (const theme of ["light", "dark"]) {
  test(`push dialog and force-push confirmation (${theme})`, async ({ page }) => {
    await openDemo(page, { theme });
    await page.getByRole("button", { name: "Push options" }).click();
    await page.getByRole("menuitem", { name: "Push…" }).click();
    const dialog = page.getByRole("dialog", { name: "Push main" });
    await expect(dialog.getByLabel("Branch on the remote")).toHaveValue("main");
    // Opened from a menu, focus still starts in the field, not on the close button.
    await expect(dialog.getByLabel("Branch on the remote")).toBeFocused();
    await shot(page, `remote-push-dialog-${theme}`);

    await dialog.getByText("Force push").click();
    await expect(dialog.getByText(/--force-with-lease/)).toBeVisible();
    await dialog.getByRole("button", { name: "Force push…" }).click();
    const confirm = page.getByRole("dialog", { name: "Force push to origin/main?" });
    await expect(confirm.getByText("origin/main will be replaced with main.")).toBeVisible();
    // Destructive: Cancel has focus, so Enter alone doesn't force push.
    await expect(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
    await shot(page, `remote-force-confirm-${theme}`);
    await confirm.getByRole("button", { name: "Force push", exact: true }).click();
    await expect(toastText(page, "Pushed main to origin/main")).toBeVisible();
  });
}

test("first push of a new remote branch sets the upstream", async ({ page }) => {
  await openDemo(page);
  await page.getByRole("button", { name: "Push options" }).click();
  await page.getByRole("menuitem", { name: "Push…" }).click();
  const dialog = page.getByRole("dialog", { name: "Push main" });
  await dialog.getByLabel("Branch on the remote").fill("ada/try");
  await dialog.getByText("Track this branch").click();
  await dialog.getByRole("button", { name: "Push", exact: true }).click();
  await expect(toastText(page, "Pushed main to origin/ada/try")).toBeVisible();
  await expect(page.getByRole("tree", { name: "origin" }).getByText("try")).toBeVisible();
});

test("credentials are asked for in a dialog during push", async ({ page }) => {
  await openDemo(page, { script: { push: "auth" } });
  await button(page, "Push").click();
  const dialog = page.getByRole("dialog", { name: "Sign in to github.com" });
  await dialog.getByLabel("Password").fill("ghp_example");
  await dialog.getByRole("button", { name: "Sign in" }).click();
  await expect(toastText(page, "Pushed main to origin/main")).toBeVisible();
});

test("remotes can be added, edited and removed from the sidebar", async ({ page }) => {
  await openDemo(page);
  const sidebar = page.getByRole("navigation");
  await sidebar.getByText("Remotes", { exact: true }).hover();
  await sidebar.getByRole("button", { name: "Add remote" }).click();
  const add = page.getByRole("dialog", { name: "Add remote" });
  await add.getByLabel("Name").fill("origin");
  await expect(add.getByText("A remote named origin already exists")).toBeVisible();
  await expect(add.getByRole("button", { name: "Add remote" })).toBeDisabled();
  await add.getByLabel("Name").fill("fork");
  await add.getByLabel("URL", { exact: true }).fill("git@github.com:ada/tylia-demo.git");
  await add.getByRole("button", { name: "Add remote" }).click();
  await expect(add).toHaveCount(0);
  await expect(sidebar.getByRole("button", { name: "fork", exact: true })).toBeVisible();

  await sidebar.getByRole("button", { name: "fork", exact: true }).hover();
  await sidebar.getByRole("button", { name: "Actions for fork" }).click();
  await page.getByRole("menuitem", { name: "Edit…" }).click();
  const edit = page.getByRole("dialog", { name: "Edit remote fork" });
  await edit.getByLabel("Name").fill("ada");
  await edit.getByRole("button", { name: "Save" }).click();
  await expect(sidebar.getByRole("button", { name: "ada", exact: true })).toBeVisible();

  await sidebar.getByRole("button", { name: "ada", exact: true }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Remove…" }).click();
  const remove = page.getByRole("dialog", { name: "Remove remote ada?" });
  await expect(remove.getByText(/Nothing changes on the server/)).toBeVisible();
  await remove.getByRole("button", { name: "Remove remote" }).click();
  await expect(sidebar.getByRole("button", { name: "ada", exact: true })).toHaveCount(0);
});

test("push after commit", async ({ page }) => {
  await openDemo(page);
  await page.getByText("Uncommitted changes").click();
  await page.getByRole("button", { name: "Stage all", exact: true }).click();
  await page.getByLabel("Commit message").fill("Tidy up");
  await page.getByText("Push after commit").click();
  await page.getByRole("button", { name: /^Commit(?! \d)/ }).click();
  await expect(toastText(page, "Pushed main to origin/main")).toBeVisible();
});

for (const theme of ["light", "dark"]) {
  for (const width of [1280, 900]) {
    test(`toolbar ${theme} ${width}`, async ({ page }) => {
      await openDemo(page, { theme, width });
      await page.waitForTimeout(300);
      await page
        .locator("div.\\@container")
        .first()
        .screenshot({ path: `e2e/__screenshots__/remote-toolbar-${theme}-${width}.png` });
    });
  }
}

test("fetch confirms success", async ({ page }) => {
  await openDemo(page);
  await button(page, "Fetch").click();
  await expect(toastText(page, "Fetched from all remotes")).toBeVisible();
});

test("after a push the button shows a check, and its tooltip keeps the result", async ({
  page,
}) => {
  await openDemo(page);
  const push = button(page, "Push");
  await push.click();
  await expect(toastText(page, "Pushed main to origin/main")).toBeVisible();
  await expect(push.locator("svg.text-success")).toBeVisible();
  await shot(page, "push-success-light");
  // Radix reopens a tooltip only after the pointer has left the button it clicked.
  await page.mouse.move(0, 400);
  await push.hover();
  await expect(page.getByRole("tooltip")).toContainText(/Pushed main to origin\/main · \d/);
  // The check mark goes after a few seconds; the tooltip keeps the result.
  await expect(push.locator("svg.text-success")).toHaveCount(0, { timeout: 8000 });
});

test("a push asked for while a fetch runs says to wait", async ({ page }) => {
  await openDemo(page, { script: { stepMs: 400 } });
  await button(page, "Fetch").click();
  await page.keyboard.press("Control+Shift+P");
  await expect(toastText(page, "Wait for “Fetching from all remotes” to finish")).toBeVisible();
});
