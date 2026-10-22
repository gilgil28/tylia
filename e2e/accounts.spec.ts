// Hosting accounts against the mock: Settings → Accounts (sign in with a token, sign out)
// and the Clone dialog's "Your repositories" (`?token=bad|unsaved`, `?repos=fail`).

import { expect, test, type Page } from "@playwright/test";

const shot = (page: Page, name: string) =>
  page.screenshot({ path: `e2e/__screenshots__/${name}.png`, animations: "disabled" });

const ACCOUNT = { provider: "github", host: "github.com", login: "ada", name: "Ada Moreno" };

async function openApp(
  page: Page,
  { query = "", theme = "light", accounts = [] as object[] } = {},
) {
  await page.addInitScript((hostingAccounts) => {
    localStorage.removeItem("tylia.web.ui");
    localStorage.setItem("tylia.web.settings", JSON.stringify({ hostingAccounts }));
  }, accounts);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/?theme=${theme}&platform=windows&repo=demo${query}`);
  await expect(page.getByText("Make edge width configurable").first()).toBeVisible();
}

async function openAccounts(page: Page) {
  await page.keyboard.press("Control+,");
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.getByRole("button", { name: "Accounts" }).click();
  return settings;
}

async function openClone(page: Page) {
  await page.keyboard.press("Control+K");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await palette.getByRole("combobox").fill("clone");
  await palette.getByRole("combobox").press("Enter");
  return page.getByRole("dialog", { name: /Clone/ });
}

const toastText = (page: Page, text: string | RegExp) => page.getByText(text).first();

for (const theme of ["light", "dark"]) {
  test(`signing in with a token adds the account (${theme})`, async ({ page }) => {
    await openApp(page, { theme });
    const settings = await openAccounts(page);
    await expect(settings.getByText("No accounts yet.")).toBeVisible();
    await settings.getByRole("button", { name: "Add account" }).click();
    await settings.getByLabel("Personal access token").fill("ghp_example");
    await shot(page, `settings-accounts-add-${theme}`);
    await settings.getByRole("button", { name: "Sign in" }).click();
    await expect(toastText(page, "Signed in as Ada Moreno on github.com")).toBeVisible();
    await expect(settings.getByText("GitHub · ada · github.com")).toBeVisible();
    await shot(page, `settings-accounts-${theme}`);
    const saved = await page.evaluate(() => localStorage.getItem("tylia.web.settings"));
    expect(JSON.stringify(JSON.parse(saved!).hostingAccounts)).not.toContain("ghp_example");
  });
}

test("a refused token keeps the form open with the reason", async ({ page }) => {
  await openApp(page, { query: "&token=bad" });
  const settings = await openAccounts(page);
  await settings.getByRole("button", { name: "Add account" }).click();
  await settings.getByLabel("Personal access token").fill("ghp_expired");
  await settings.getByRole("button", { name: "Sign in" }).click();
  await expect(settings.getByRole("alert")).toContainText("refused the token");
  await expect(settings.getByText("No accounts yet.")).toHaveCount(0);
  await expect(settings.getByLabel("Personal access token")).toBeVisible();
});

test("Bitbucket asks for the account email; no credential helper is mentioned", async ({
  page,
}) => {
  await openApp(page, { query: "&token=unsaved" });
  const settings = await openAccounts(page);
  await settings.getByRole("button", { name: "Add account" }).click();
  await settings.getByRole("radio", { name: "Bitbucket" }).click();
  await expect(settings.getByLabel(/^Server/)).toHaveCount(0);
  await settings.getByLabel("Atlassian account email").fill("ada@example.com");
  await settings.getByLabel("Personal access token").fill("ATATT_example");
  await settings.getByRole("button", { name: "Sign in" }).click();
  await expect(toastText(page, /keeps the token only until it quits/)).toBeVisible();
  await expect(settings.getByText("Bitbucket · ada@example.com · bitbucket.org")).toBeVisible();
});

test("signing out asks first and removes the account", async ({ page }) => {
  await openApp(page, { accounts: [ACCOUNT] });
  const settings = await openAccounts(page);
  await settings.getByRole("button", { name: "Sign out" }).click();
  const confirm = page.getByRole("dialog", { name: "Sign out Ada Moreno?" });
  await confirm.getByRole("button", { name: "Sign out" }).click();
  await expect(settings.getByText("No accounts yet.")).toBeVisible();
});

for (const theme of ["light", "dark"]) {
  test(`the Clone dialog lists the account's repositories on request (${theme})`, async ({
    page,
  }) => {
    await openApp(page, { theme, accounts: [ACCOUNT] });
    const clone = await openClone(page);
    // Opening the dialog doesn't contact the provider.
    await page.waitForTimeout(300);
    expect(
      await page.evaluate(
        () => (window as { __tyliaHostingCalls?: number }).__tyliaHostingCalls ?? 0,
      ),
    ).toBe(0);
    await clone.getByRole("radio", { name: "Your repositories" }).click();
    const list = clone.getByRole("listbox", { name: "Your repositories" });
    await expect(list.getByRole("option")).toHaveCount(5);
    await clone.getByLabel("Search your repositories").fill("eng");
    await expect(list.getByRole("option")).toHaveCount(1);
    await shot(page, `clone-your-repos-${theme}`);
    await list.getByRole("option", { name: /acme\/engine/ }).click();
    await expect(clone.getByLabel("Repository URL")).toHaveValue(
      "https://github.com/acme/engine.git",
    );
    await clone.getByText("Clone over SSH").click();
    await list.getByRole("option", { name: /acme\/engine/ }).click();
    await expect(clone.getByLabel("Repository URL")).toHaveValue("git@github.com:acme/engine.git");
  });
}

test("without accounts there is no repository list; a failing provider says why", async ({
  page,
}) => {
  await openApp(page);
  let clone = await openClone(page);
  await expect(clone.getByRole("radio", { name: "Your repositories" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await openApp(page, { query: "&repos=fail", accounts: [ACCOUNT] });
  clone = await openClone(page);
  await clone.getByRole("radio", { name: "Your repositories" }).click();
  await expect(clone.getByRole("alert")).toContainText("Couldn't reach github.com");
});
