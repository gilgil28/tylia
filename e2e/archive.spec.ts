// "Export archive…" from the commit, branch and tag menus and the palette, against the mock.

import { expect, test, type Page } from "@playwright/test";

async function openDemo(page: Page, query = "") {
  await page.addInitScript(() => {
    localStorage.removeItem("tylia.web.ui");
    localStorage.removeItem("tylia.web.settings");
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/?theme=light&platform=windows&repo=demo${query}`);
  await expect(page.getByText("Make edge width configurable").first()).toBeVisible();
}

const toastText = (page: Page, text: string | RegExp) => page.getByText(text).first();

test("a commit, a branch and a tag export from their menus", async ({ page }) => {
  await openDemo(page);
  await page
    .getByRole("row")
    .filter({ hasText: "Make edge width configurable" })
    .first()
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Export archive…" }).click();
  await expect(toastText(page, "Exported 66c71f7")).toBeVisible();
  await expect(toastText(page, /tylia-demo-66c71f7\.zip/)).toBeVisible();

  await page.getByRole("tree", { name: "Branches" }).getByText("graph").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Export archive…" }).click();
  await expect(toastText(page, /tylia-demo-feature-graph\.zip/)).toBeVisible();
});

test("the palette exports the current branch; a closed dialog exports nothing", async ({
  page,
}) => {
  await openDemo(page);
  await page.keyboard.press("Control+K");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await palette.getByRole("combobox").fill("export an archive");
  await palette.getByRole("combobox").press("Enter");
  await expect(toastText(page, "Exported main")).toBeVisible();

  await openDemo(page, "&save=cancel");
  await page.keyboard.press("Control+K");
  await palette.getByRole("combobox").fill("export an archive");
  await palette.getByRole("combobox").press("Enter");
  await expect(page.getByText(/^Exported /)).toHaveCount(0);
});
