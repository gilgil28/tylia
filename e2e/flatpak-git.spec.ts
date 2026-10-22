// Settings → Git in the Flatpak: the bundled Git, or (opt-in) the system's, against the mock
// (`?distribution=flatpak`; `?hostgit=denied` simulates the missing `flatpak override`).

import { expect, test, type Page } from "@playwright/test";

const shot = (page: Page, name: string) =>
  page.screenshot({ path: `e2e/__screenshots__/${name}.png`, animations: "disabled" });

async function openGitSettings(page: Page, query: string, theme = "light") {
  await page.addInitScript(() => {
    localStorage.removeItem("tylia.web.ui");
    localStorage.removeItem("tylia.web.settings");
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/?theme=${theme}&platform=linux&repo=demo&distribution=flatpak${query}`);
  await expect(page.getByText("Make edge width configurable").first()).toBeVisible();
  await page.keyboard.press("Control+,");
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.getByRole("button", { name: "Git", exact: true }).click();
  return settings;
}

test("the Flatpak offers the system's Git instead of a path", async ({ page }) => {
  const settings = await openGitSettings(page, "");
  await expect(settings.getByRole("textbox", { name: "Git executable" })).toHaveCount(0);
  await expect(settings.getByText(/git version 2\.50\.1 · inside the Flatpak/)).toBeVisible();
  await settings.getByRole("checkbox", { name: "Use the system’s Git" }).click();
  await expect(settings.getByText(/git version 2\.53\.0 · on this computer/)).toBeVisible();
});

for (const theme of ["light", "dark"]) {
  test(`without the permission it says how to grant it (${theme})`, async ({ page }) => {
    const settings = await openGitSettings(page, "&hostgit=denied", theme);
    await settings.getByRole("checkbox", { name: "Use the system’s Git" }).click();
    await expect(settings.getByText(/may not run programs outside its sandbox/)).toBeVisible();
    await expect(
      settings.getByText(
        "flatpak override --user --talk-name=org.freedesktop.Flatpak io.github.gilgil28.tylia",
      ),
    ).toBeVisible();
    await shot(page, `settings-flatpak-git-${theme}`);
  });
}

test("elsewhere the Git executable can be chosen", async ({ page }) => {
  await page.goto("/?theme=light&platform=linux&repo=demo");
  await expect(page.getByText("Make edge width configurable").first()).toBeVisible();
  await page.keyboard.press("Control+,");
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.getByRole("button", { name: "Git", exact: true }).click();
  await expect(settings.getByRole("textbox", { name: "Git executable" })).toBeVisible();
  await expect(settings.getByRole("checkbox", { name: "Use the system’s Git" })).toHaveCount(0);
});
