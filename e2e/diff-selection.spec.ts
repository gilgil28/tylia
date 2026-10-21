// Line selection in the diff viewer (gallery): click, Shift-click, drag, Escape.

import { expect, test, type Locator, type Page } from "@playwright/test";

async function openSection(page: Page): Promise<Locator> {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/?theme=light#/gallery");
  await page.evaluate(() => document.fonts.ready);
  const section = page.getByTestId("diff-section");
  await section.scrollIntoViewIfNeeded();
  return section;
}

const gutter = (section: Locator, key: string) => section.locator(`[data-line-key="${key}"]`);

async function centre(locator: Locator): Promise<{ x: number; y: number }> {
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function drag(page: Page, from: Locator, to: Locator) {
  const start = await centre(from);
  const end = await centre(to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 6 });
  await page.mouse.up();
}

test("click, shift-click, drag and escape", async ({ page }) => {
  const section = await openSection(page);
  const selected = section.getByTestId("diff-selected");

  // Click toggles; context lines aren't selectable.
  await expect(gutter(section, "0:0")).toHaveCount(0);
  await gutter(section, "0:1").click();
  await expect(selected).toHaveText("1 line selected");
  await gutter(section, "0:1").click();
  await expect(selected).toHaveText("0 lines selected");

  // Shift-click adds the changed lines from the last clicked one: 0:1, 0:3, 0:4.
  await gutter(section, "0:1").click();
  await gutter(section, "0:4").click({ modifiers: ["Shift"] });
  await expect(selected).toHaveText("3 lines selected");
  await expect(section.getByRole("button", { name: "Stage 3 lines" })).toBeVisible();
  await expect(section.getByRole("button", { name: "Stage hunk" })).toHaveCount(2);

  // A drag selects every changed line passed over: 1:1, 1:2, 1:3, 1:4.
  await drag(page, gutter(section, "1:1"), gutter(section, "1:4"));
  await expect(selected).toHaveText("7 lines selected");
  // The gutter isn't text: dragging over it selects lines, never text.
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("");

  // A drag that starts on a selected line deselects.
  await drag(page, gutter(section, "0:4"), gutter(section, "0:1"));
  await expect(selected).toHaveText("4 lines selected");

  // Escape (the diff has focus after a click) clears.
  await page.keyboard.press("Escape");
  await expect(selected).toHaveText("0 lines selected");
});

test("side by side, each column selects its own lines", async ({ page }) => {
  const section = await openSection(page);
  const selected = section.getByTestId("diff-selected");
  await section.getByRole("radio", { name: "Side by side" }).click();

  // Removals on the left, additions on the right.
  const region = (await section.getByRole("region", { name: /^Changes in/ }).boundingBox())!;
  const left = (await gutter(section, "1:1").boundingBox())!.x - region.x;
  const right = (await gutter(section, "1:3").boundingBox())!.x - region.x;
  expect(left).toBeLessThan(region.width / 4);
  expect(right).toBeGreaterThan(region.width / 3);

  // Shift-click within a column keeps to it: 0:1 and 0:4, not the removed 0:3.
  await gutter(section, "0:1").click();
  await gutter(section, "0:4").click({ modifiers: ["Shift"] });
  await expect(selected).toHaveText("2 lines selected");

  // Dragging down the left column from 1:1 passes 1:2 and 1:7 (the right side's 1:3/1:4
  // and context rows in between stay as they were).
  await drag(page, gutter(section, "1:1"), gutter(section, "1:7"));
  await expect(selected).toHaveText("5 lines selected");
  await expect(section.getByRole("button", { name: "Stage 3 lines" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(selected).toHaveText("0 lines selected");
});

test("selecting code text doesn't select lines", async ({ page }) => {
  const section = await openSection(page);
  const selected = section.getByTestId("diff-selected");
  // Highlighting re-renders the text, which would drop a selection made before it lands.
  // The worker's first grammar load is slow when many browsers run in parallel.
  test.setTimeout(90_000);
  await expect(section.locator("[data-selectable] span[style*='color']").first()).toBeVisible({
    timeout: 60_000,
  });
  const code = gutter(section, "0:1").locator("xpath=following-sibling::*[1]");
  const box = (await code.boundingBox())!;
  await page.mouse.move(box.x + 40, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 160, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  expect(await page.evaluate(() => window.getSelection()?.toString().length)).toBeGreaterThan(0);
  await expect(selected).toHaveText("0 lines selected");
});

// About 20 lines fit in the gallery's diff, so more than 40 selected means it scrolled.
test("dragging past the edge scrolls and keeps selecting", async ({ page }) => {
  const section = await openSection(page);
  const selected = section.getByTestId("diff-selected");
  await section.getByRole("radio", { name: "20k lines" }).click();
  const region = section.getByRole("region", { name: /^Changes in/ });
  const box = (await region.boundingBox())!;
  const start = await centre(gutter(section, "0:0"));
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x, box.y + box.height + 40, { steps: 4 });
  await expect
    .poll(async () => parseInt((await selected.textContent()) ?? "", 10))
    .toBeGreaterThan(40);
  await page.mouse.up();
  expect(await region.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
});
