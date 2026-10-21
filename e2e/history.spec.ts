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
