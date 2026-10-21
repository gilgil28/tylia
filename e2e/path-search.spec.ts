// History search by file: suggestions from every path in history, recent path searches,
// `path:` prefixes and keyboard use, against the mock.

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const shot = (page: Page, name: string) =>
  page.screenshot({ path: `e2e/__screenshots__/${name}.png`, animations: "disabled" });

async function open(page: Page, theme = "light") {
  await page.addInitScript(() => {
    localStorage.removeItem("tylia.web.ui");
    localStorage.removeItem("tylia.web.settings");
  });
  await page.setViewportSize({ width: 1440, height: 860 });
  await page.goto(`/?theme=${theme}&platform=windows&repo=demo`);
  await expect(page.getByText("Make edge width configurable").first()).toBeVisible();
}

const searchBox = (page: Page) => page.getByRole("combobox", { name: "Search history" });
const options = (page: Page) =>
  page.getByRole("listbox", { name: "Matching files and folders" }).getByRole("option");

for (const theme of ["light", "dark"]) {
  test(`suggests files from history, including gone ones (${theme})`, async ({ page }) => {
    await open(page, theme);
    await page.getByRole("textbox", { name: "Search history" }).fill("path:pars");
    const box = searchBox(page);
    await expect(box).toHaveValue("pars");
    await expect(page.getByRole("button", { name: "Search by: Path" })).toBeVisible();
    await expect(box).toHaveAttribute("aria-expanded", "true");
    await expect(options(page).first()).toContainText("parser.rs");
    const gone = options(page).filter({ hasText: "legacy_parser.rs" });
    await expect(gone).toContainText("History only");
    await shot(page, `path-search-suggestions-${theme}`);
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .include("[role=listbox]")
      .include("[role=combobox]")
      .analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
}

test("keyboard picks a suggestion, filters history and remembers it", async ({ page }) => {
  await open(page);
  await page.getByRole("textbox", { name: "Search history" }).fill("file:main");
  const box = searchBox(page);
  await expect(options(page).first()).toContainText("main.rs");
  await box.press("ArrowDown");
  await expect(box).toHaveAttribute("aria-activedescendant", /.+/);
  await box.press("Enter");
  await expect(box).toHaveValue("src/main.rs");
  await expect(box).toHaveAttribute("aria-expanded", "false");
  // Only commits that changed src/main.rs remain.
  await expect(
    page.getByRole("row").filter({ hasText: "Make edge width configurable" }),
  ).toHaveCount(0);

  // Cleared and focused again: the recent search is offered first.
  await box.press("Escape");
  await expect(box).toHaveValue("");
  await box.fill("src");
  await expect(page.getByRole("listbox", { name: "Matching files and folders" })).toContainText(
    "Recent",
  );
  await expect(options(page).first()).toContainText("main.rs");
});

test("Escape closes the list, then clears the search", async ({ page }) => {
  await open(page);
  await page.getByRole("textbox", { name: "Search history" }).fill("path:guide");
  const box = searchBox(page);
  await expect(box).toHaveAttribute("aria-expanded", "true");
  await box.press("Escape");
  await expect(box).toHaveAttribute("aria-expanded", "false");
  await expect(box).toHaveValue("guide");
  await box.press("Escape");
  await expect(box).toHaveValue("");
});

test("other prefixes switch the field", async ({ page }) => {
  await open(page);
  await page.getByRole("textbox", { name: "Search history" }).fill("author:ada");
  await expect(page.getByRole("button", { name: "Search by: Author" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Search history" })).toHaveValue("ada");
  // An unknown prefix is just text.
  await page.getByRole("textbox", { name: "Search history" }).fill("fix: typo");
  await expect(page.getByRole("button", { name: "Search by: Author" })).toBeVisible();
});
