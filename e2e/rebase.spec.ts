// Interactive rebase editor against the mock backend (src/ipc/mock/rebase.ts): actions,
// keyboard and drag reordering, the result preview, validation, the confirmation, and an
// `edit` stop handed to the operation banner. Writes screenshots for review against
// docs/DESIGN.md §4.13.

import { expect, test, type Locator, type Page } from "@playwright/test";

const shot = (page: Page, name: string) =>
  page.screenshot({ path: `e2e/__screenshots__/${name}.png`, animations: "disabled" });

async function openDemo(page: Page, theme = "light", outcome: "ok" | "conflicts" = "ok") {
  await page.addInitScript((o) => {
    localStorage.removeItem("tylia.web.ui");
    localStorage.removeItem("tylia.web.settings");
    window.__tyliaRebase = { outcome: o };
  }, outcome);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/?theme=${theme}&platform=windows&repo=demo`);
  await expect(page.getByText("Make edge width configurable").first()).toBeVisible();
}

const historyRow = (page: Page, subject: string) =>
  page.getByRole("row").filter({ hasText: subject }).first();

/** Opens the editor for the commits after "Keep lane colours stable (39)": Add logo, Use the
 * new square logo (both pushed), Make edge width configurable, Parse commit trailers. */
async function openEditor(page: Page): Promise<Locator> {
  await historyRow(page, "Keep lane colours stable (39)").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Interactively rebase from here…" }).click();
  const dialog = page.getByRole("dialog", { name: "Interactive rebase of main" });
  await expect(dialog.getByText("Parse commit trailers").first()).toBeVisible();
  return dialog;
}

const todoRow = (dialog: Locator, subject: string) =>
  dialog.getByRole("list", { name: "Commits to rebase, oldest first" }).locator("li").filter({
    hasText: subject,
  });

const rowSubjects = (dialog: Locator) =>
  dialog
    .getByRole("list", { name: "Commits to rebase, oldest first" })
    .locator("li [data-row] span[title]")
    .allTextContents();

for (const theme of ["light", "dark"]) {
  test(`edit a plan: actions, reorder, preview, confirm (${theme})`, async ({ page }) => {
    await openDemo(page, theme);
    const dialog = await openEditor(page);
    const summary = dialog.getByTestId("rebase-summary");
    await expect(summary).toHaveText("4 commits → 4");
    await expect(dialog.getByRole("button", { name: "Rebase…" })).toBeDisabled();

    // Reword through the action menu: the message editor opens with the old message.
    await dialog.getByRole("combobox", { name: "Action for 73f4a9d" }).click();
    await page.getByRole("option", { name: /Reword/ }).click();
    const message = dialog.getByLabel("New message for 73f4a9d");
    await expect(message).toHaveValue(/^Add logo/);
    await message.fill("Add the square logo");

    // Squash and drop with the row keys (Git's todo letters).
    await todoRow(dialog, "Make edge width configurable").locator("[data-row]").press("s");
    await expect(dialog.getByLabel("Message for the combined commit")).toHaveValue(
      /Use the new square logo[\s\S]*Make edge width configurable/,
    );
    await todoRow(dialog, "Parse commit trailers").locator("[data-row]").press("d");
    await expect(summary).toHaveText("4 commits → 2");

    // Alt+↑ moves the focused row up and keeps it focused.
    const parse = todoRow(dialog, "Parse commit trailers").locator("[data-row]");
    await parse.press("Alt+ArrowUp");
    await expect(todoRow(dialog, "Parse commit trailers").locator("[data-row]")).toBeFocused();
    expect(await rowSubjects(dialog)).toEqual([
      "Add logo",
      "Use the new square logo",
      "Parse commit trailers",
      "Make edge width configurable",
    ]);
    // A squash now has only a dropped commit above it and folds into "Use the new square logo".
    await expect(summary).toHaveText("4 commits → 2");

    const preview = dialog.getByRole("complementary", { name: "Result" });
    await expect(preview.getByText("Add the square logo")).toBeVisible();
    await expect(preview.getByText("+1 folded in")).toBeVisible();
    await expect(preview.getByText("2 already pushed")).toBeVisible();
    await page.mouse.move(0, 0);
    await shot(page, `rebase-editor-${theme}`);

    await dialog.getByRole("button", { name: "Rebase…" }).click();
    const confirm = page.getByRole("dialog", { name: "Rewrite the history of main?" });
    await expect(confirm.getByText("2 commits are rewritten and get new ids")).toBeVisible();
    await expect(confirm.getByText(/2 of them are already on a remote/)).toBeVisible();
    await expect(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
    await shot(page, `rebase-confirm-${theme}`);
    await confirm.getByRole("button", { name: "Rebase" }).click();
    await expect(page.getByText("Rebased main").first()).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
}

test("drag a row by its handle to reorder", async ({ page }) => {
  await openDemo(page);
  const dialog = await openEditor(page);
  const handle = todoRow(dialog, "Parse commit trailers").getByRole("button", {
    name: /Drag to reorder/,
  });
  const target = todoRow(dialog, "Add logo");
  const from = (await handle.boundingBox())!;
  const to = (await target.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(from.x + from.width / 2, from.y + ((to.y - 4 - from.y) * i) / 8);
  }
  await page.mouse.up();
  expect(await rowSubjects(dialog)).toEqual([
    "Parse commit trailers",
    "Add logo",
    "Use the new square logo",
    "Make edge width configurable",
  ]);
  await expect(dialog.getByRole("button", { name: "Rebase…" })).toBeEnabled();
});

test("a squash with nothing above it can't start", async ({ page }) => {
  await openDemo(page);
  const dialog = await openEditor(page);
  await todoRow(dialog, "Add logo").locator("[data-row]").press("f");
  await expect(dialog.getByText("Nothing above to fold this into")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Rebase…" })).toBeDisabled();
  await todoRow(dialog, "Add logo").locator("[data-row]").press("p");
  await expect(dialog.getByText("Nothing above to fold this into")).toHaveCount(0);
});

test("an edit stop hands over to the operation banner", async ({ page }) => {
  await openDemo(page);
  const dialog = await openEditor(page);
  await todoRow(dialog, "Make edge width configurable").locator("[data-row]").press("e");
  await expect(dialog.getByRole("complementary").getByText("Stops to edit")).toBeVisible();
  await dialog.getByRole("button", { name: "Rebase…" }).click();
  const confirm = page.getByRole("dialog", { name: "Rewrite the history of main?" });
  await expect(confirm.getByText(/stops at each commit marked Edit/)).toBeVisible();
  await confirm.getByRole("button", { name: "Rebase" }).click();
  await expect(page.getByText("Stopped to edit 66c71f7").first()).toBeVisible();
  const banner = page.getByRole("status").filter({ hasText: "Rebasing main" });
  await expect(banner).toContainText("Rebasing main: stopped to edit 66c71f7");
  await expect(banner).toContainText("Amend or add commits, then continue");
  await page.mouse.move(0, 0);
  await shot(page, "rebase-edit-stop-light");
  await banner.getByRole("button", { name: "Continue" }).click();
  await expect(banner).toHaveCount(0);
});

test("conflicts stop like a normal rebase", async ({ page }) => {
  await openDemo(page, "light", "conflicts");
  const dialog = await openEditor(page);
  await todoRow(dialog, "Parse commit trailers").locator("[data-row]").press("Alt+ArrowUp");
  await dialog.getByRole("button", { name: "Rebase…" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Rebase" }).click();
  await expect(page.getByText("The rebase stopped on conflicts").first()).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "1 conflict" })).toBeVisible();
});

test("only ancestors of HEAD offer an interactive rebase", async ({ page }) => {
  await openDemo(page);
  // On feature/line-staging, not on main.
  await historyRow(page, "Handle no-newline markers").click({ button: "right" });
  await expect(
    page.getByRole("menuitem", { name: "Interactively rebase from here…" }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  // HEAD itself has nothing after it.
  await historyRow(page, "Parse commit trailers").click({ button: "right" });
  await expect(
    page.getByRole("menuitem", { name: "Interactively rebase from here…" }),
  ).toBeDisabled();
});

test("a range with merge commits is refused with a reason", async ({ page }) => {
  await openDemo(page);
  await page.getByPlaceholder("Search messages").fill("Speed up startup");
  await historyRow(page, "Speed up startup").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Interactively rebase from here…" }).click();
  const dialog = page.getByRole("dialog", { name: "Interactive rebase of main" });
  await expect(dialog.getByRole("alert")).toContainText("include a merge commit");
});
