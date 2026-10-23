// Behaviour checks for the history view in browser mode (mock backend).

import { expect, test, type Page } from "@playwright/test";

async function openDemo(page: Page) {
  await page.addInitScript(() => localStorage.removeItem("tylia.web.ui"));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/?theme=light&platform=windows&repo=demo");
  await expect(page.getByText("Parse commit trailers").first()).toBeVisible();
}

const width = (page: Page, column: string) =>
  page.locator(`[data-column="${column}"]`).evaluate((el) => el.getBoundingClientRect().width);

async function dragHandle(page: Page, column: string, dx: number) {
  const handle = page.getByRole("separator", { name: new RegExp(`Resize ${column}`, "i") });
  const box = (await handle.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y);
  await page.mouse.move(x + dx, y);
  await page.mouse.up();
}

test("each history column resizes on its own", async ({ page }) => {
  await openDemo(page);
  const before = {
    description: await width(page, "description"),
    author: await width(page, "author"),
    date: await width(page, "date"),
  };

  await dragHandle(page, "Author", 60);
  expect(await width(page, "author")).toBeCloseTo(before.author + 60, 0);
  expect(await width(page, "description")).toBeCloseTo(before.description, 0);
  expect(await width(page, "date")).toBeCloseTo(before.date, 0);

  // Narrowing the description doesn't widen any other column.
  await dragHandle(page, "Description", -100);
  expect(await width(page, "description")).toBeCloseTo(before.description - 100, 0);
  expect(await width(page, "author")).toBeCloseTo(before.author + 60, 0);
  expect(await width(page, "date")).toBeCloseTo(before.date, 0);

  // Rows follow the header.
  const rowAuthor = await page
    .locator('[role="grid"] [role="row"]')
    .nth(1)
    .locator(":scope > div")
    .nth(2)
    .evaluate((el) => el.getBoundingClientRect().width);
  expect(rowAuthor).toBeCloseTo(before.author + 60, 0);

  // Double-click resets a column.
  await page.getByRole("separator", { name: /Resize Author/i }).dblclick();
  await expect.poll(() => width(page, "author")).toBeCloseTo(before.author, 0);
});

test("recently lost commits open in the details pane and search deeper finds more", async ({
  page,
}) => {
  await openDemo(page);
  const sidebar = page.getByRole("navigation");
  await sidebar.getByRole("button", { name: "Recently lost" }).click();
  const lost = sidebar.getByRole("button", { name: /^\S.*\+1$/ });
  await expect(lost).toHaveCount(1);
  await lost.click();
  await expect(page.getByRole("heading").first()).toBeVisible();
  await sidebar.getByRole("button", { name: "Search deeper" }).click();
  await expect(sidebar.getByText("On main: work in progress")).toBeVisible();
});

test("a signed commit says so in its details, an unsigned one says nothing", async ({ page }) => {
  await openDemo(page);
  await page.getByText("Parse commit trailers").first().click();
  const badge = page.getByText("Signed", { exact: true });
  await expect(badge).toBeVisible();
  await expect(badge).toHaveAttribute("title", /By ada@example\.com/);
  await page.getByText("Make edge width configurable").first().click();
  await expect(page.getByRole("heading", { name: "Make edge width configurable" })).toBeVisible();
  await expect(page.getByText("Signed", { exact: true })).toHaveCount(0);
});

test("a commit's tags are listed in its details with their signatures", async ({ page }) => {
  await openDemo(page);
  const sidebar = page.getByRole("navigation");
  await sidebar.getByRole("button", { name: /^Tags/ }).click();
  await sidebar.getByRole("button", { name: "v0.1.0", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Prepare 0.1.0" })).toBeVisible();
  const details = page.getByRole("definition").filter({ hasText: "v0.1.0" });
  await expect(details).toBeVisible();
  const badge = details.getByText("Signed", { exact: true });
  await expect(badge).toHaveAttribute("title", /By Ada Moreno/);
});
