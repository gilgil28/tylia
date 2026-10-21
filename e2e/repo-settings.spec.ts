// Repository settings (remotes, authentication, identity), against the mock.

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const shot = (page: Page, name: string) =>
  page.screenshot({ path: `e2e/__screenshots__/${name}.png`, animations: "disabled" });

async function open(page: Page, theme = "light") {
  await page.addInitScript(() => {
    localStorage.removeItem("tylia.web.ui");
    localStorage.removeItem("tylia.web.settings");
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/?theme=${theme}&platform=windows&repo=demo`);
  await expect(page.getByText("Make edge width configurable").first()).toBeVisible();
}

async function openRepoSettings(page: Page) {
  await page.getByRole("button", { name: "Repository settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Repository settings tylia-demo" });
  await expect(dialog).toBeVisible();
  return dialog;
}

for (const theme of ["light", "dark"]) {
  test(`remotes show their protocol and switch to SSH (${theme})`, async ({ page }) => {
    await open(page, theme);
    const dialog = await openRepoSettings(page);
    const origin = dialog.getByRole("listitem").filter({ hasText: "origin" });
    await expect(origin).toContainText("HTTPS");
    await expect(origin).toContainText("https://github.com/tylia-dev/tylia-demo.git");
    await shot(page, `repo-settings-remotes-${theme}`);
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .include("[role=dialog]")
      .analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);

    await origin.getByRole("button", { name: "Use SSH" }).click();
    await expect(
      page.getByText("origin now uses git@github.com:tylia-dev/tylia-demo.git").first(),
    ).toBeVisible();
    await expect(origin).toContainText("SSH");
    await expect(origin.getByRole("button", { name: "Use HTTPS" })).toBeVisible();
  });
}

test("authentication: choose an SSH key and forget a saved sign-in", async ({ page }) => {
  await open(page, "dark");
  const dialog = await openRepoSettings(page);
  await dialog.getByRole("button", { name: "Authentication" }).click();
  await expect(
    dialog.getByText("Saved by Git Credential Manager (your global settings)."),
  ).toBeVisible();
  await dialog.getByRole("radio", { name: "Use a key file" }).click();
  await dialog.getByRole("button", { name: "Browse…" }).click();
  await expect(dialog.getByRole("textbox", { name: "Private key file" })).toHaveValue(
    "C:/Users/ada/.ssh/id_ed25519",
  );
  await shot(page, "repo-settings-auth-dark");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("This repository now uses that SSH key").first()).toBeVisible();

  await dialog.getByRole("button", { name: "Forget sign-in for github.com" }).click();
  const confirm = page.getByRole("dialog", { name: "Forget the saved sign-in for github.com?" });
  await confirm.getByRole("button", { name: "Forget sign-in" }).click();
  await expect(page.getByText("Forgot the sign-in for github.com").first()).toBeVisible();

  // Back to the default keys.
  await dialog.getByRole("radio", { name: "Default" }).click();
  await expect(
    page.getByText("This repository uses the default SSH keys again").first(),
  ).toBeVisible();
});

test("identity: a repository name and email over the global ones", async ({ page }) => {
  await open(page);
  const dialog = await openRepoSettings(page);
  await dialog.getByRole("button", { name: "Identity" }).click();
  const name = dialog.getByRole("textbox", { name: "Name" });
  await expect(name).toHaveAttribute("placeholder", "Ada Moreno");
  await expect(dialog.getByText("Using your global Git identity.")).toBeVisible();
  await name.fill("Ada (work)");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Identity saved").first()).toBeVisible();
  await expect(dialog.getByText("This repository has its own identity.")).toBeVisible();
  await dialog.getByRole("button", { name: "Use global" }).click();
  await expect(dialog.getByText("Using your global Git identity.")).toBeVisible();
});

test("the palette and the sidebar open repository settings", async ({ page }) => {
  await open(page);
  await page.keyboard.press("Control+K");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await palette.getByRole("combobox").fill("ssh key");
  await palette.getByRole("option", { name: /Repository settings/ }).click();
  await expect(page.getByRole("dialog", { name: "Repository settings tylia-demo" })).toBeVisible();
  await page.keyboard.press("Escape");
  // The header's buttons show while the pointer is over it.
  await page
    .getByRole("navigation")
    .getByRole("button", { name: /^Remotes/ })
    .hover();
  await page.getByRole("navigation").getByRole("button", { name: "Manage remotes" }).click();
  await expect(page.getByRole("dialog", { name: "Repository settings tylia-demo" })).toBeVisible();
});
