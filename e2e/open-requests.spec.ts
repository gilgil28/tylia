// Folders handed to Tylia from outside (`tylia <path>`, a second launch, "Open in Tylia")
// open as tabs, against the mock (src/ipc/mock/open-requests.ts).

import { expect, test, type Page } from "@playwright/test";

async function open(page: Page, query = "") {
  await page.addInitScript(() => localStorage.removeItem("tylia.web.ui"));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/?theme=light&platform=windows${query}`);
}

test("the launch's folders open as tabs, the last one active", async ({ page }) => {
  await open(page, "&open=/home/ada/code/website&open=/home/ada/code/tylia-demo");
  await expect(page.getByRole("tab", { name: /website/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /tylia-demo/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByText("Make edge width configurable").first()).toBeVisible();
});

test("a later launch opens its folder in the running window", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("tab", { name: /tylia-demo/ })).toHaveCount(0);
  await page.waitForFunction(() => window.__tyliaOpen?.listening());
  await page.evaluate(() => window.__tyliaOpen!.launch(["/home/ada/code/tylia-demo"]));
  await expect(page.getByRole("tab", { name: /tylia-demo/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("a folder that isn't a repository says so", async ({ page }) => {
  await open(page, "&open=/home/ada/Downloads");
  await expect(page.getByText("Couldn’t open repository").first()).toBeVisible();
  await expect(page.getByText("/home/ada/Downloads isn’t a Git repository.").first()).toBeVisible();
});
