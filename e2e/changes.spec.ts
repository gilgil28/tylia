// Behaviour checks for the Changes view in browser mode (mock backend).

import { expect, test, type Page } from "@playwright/test";

async function openChanges(page: Page) {
  await page.addInitScript(() => localStorage.removeItem("tylia.web.ui"));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/?theme=light&platform=windows&repo=demo");
  await page.getByRole("button", { name: /^Changes/ }).click();
  await expect(page.getByText("Unstaged · 2")).toBeVisible();
}

test("stages by drag and unstages by checkbox", async ({ page }) => {
  await openChanges(page);
  const row = page.getByRole("option", { name: /notes\.md/ });
  const target = page.locator('[data-drop-area="staged"]');
  const from = (await row.boundingBox())!;
  const to = (await target.boundingBox())!;
  await page.mouse.move(from.x + 60, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 80, from.y + 40, { steps: 4 });
  await page.mouse.move(to.x + 60, to.y + to.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByText("Staged · 2")).toBeVisible();
  await expect(page.getByText("Unstaged · 1")).toBeVisible();

  await page
    .getByRole("listbox", { name: "Staged" })
    .getByRole("option", { name: /curves\.rs/ })
    // The row checkbox is mouse-only (Space stages from the keyboard): found by its state.
    .locator("[data-state]")
    .click();
  await expect(page.getByText("Staged · 1")).toBeVisible();
});

test("commit is enabled only with a message and staged changes", async ({ page }) => {
  await openChanges(page);
  const commit = page.getByRole("button", { name: /^Commit/ });
  await expect(commit).toBeDisabled();
  await page.getByRole("textbox", { name: "Commit message" }).fill("Add curves");
  await expect(commit).toBeEnabled();
  await commit.click();
  await expect(page.getByText("Committed 0123456", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Commit message" })).toHaveValue("");
});

test("diff shows changes only by default, with a full-file toggle that resets per file", async ({
  page,
}) => {
  await openChanges(page);
  await page.getByRole("option", { name: /parser\.rs/ }).click();
  const toggle = page.getByRole("button", { name: "Show full file" });
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(page.getByRole("button", { name: "Show changes only" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // Another file starts with changes only again.
  await page.getByRole("option", { name: /notes\.md/ }).click();
  await expect(page.getByRole("button", { name: "Show full file" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});

test("staging moves the file at once (before Git answers)", async ({ page }) => {
  await openChanges(page);
  const row = page
    .getByRole("listbox", { name: "Unstaged" })
    .getByRole("option", { name: /notes\.md/ });
  const started = Date.now();
  await row.locator("[data-state]").click();
  await expect(
    page.getByRole("listbox", { name: "Staged" }).getByRole("option", { name: /notes\.md/ }),
  ).toBeVisible();
  expect(Date.now() - started).toBeLessThan(1000);
});
