// Diff viewer screenshots from the gallery, for review against docs/DESIGN.md §4.13.
// Writes e2e/__screenshots__/diff-*.png.

import { expect, test, type Locator, type Page } from "@playwright/test";

const THEMES = ["light", "dark"] as const;
const PLATFORM = process.env.SHOTS_PLATFORM ?? "windows";

async function openSection(page: Page, theme: string): Promise<Locator> {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/?theme=${theme}&platform=${PLATFORM}#/gallery`);
  await page.evaluate(() => document.fonts.ready);
  const section = page.getByTestId("diff-section");
  await section.scrollIntoViewIfNeeded();
  return section;
}

async function pick(section: Locator, group: string, name: string) {
  await section.getByRole("radiogroup", { name: group }).getByRole("radio", { name }).click();
}

/** Waits until syntax colours from the worker are on screen. */
async function highlighted(section: Locator) {
  // The highlight worker's first grammar load is slow when many browsers run in parallel.
  await expect(section.locator("[data-selectable] span[style*='color']").first()).toBeVisible({
    timeout: 20_000,
  });
}

const shot = (section: Locator, name: string) =>
  section.screenshot({ path: `e2e/__screenshots__/diff-${name}.png`, animations: "disabled" });

for (const theme of THEMES) {
  test.describe(theme, () => {
    test("text diffs", async ({ page }) => {
      const section = await openSection(page, theme);
      await highlighted(section);
      await shot(section, `typescript-unified-${theme}`);

      // Sideways: the gutter and hunk headers stay put while code scrolls.
      const scroller = section.getByRole("region", { name: /^Changes in/ });
      await scroller.evaluate((el) => (el.scrollLeft = 240));
      await section
        .getByRole("button", { name: /unchanged lines/ })
        .first()
        .focus();
      await shot(section, `typescript-unified-scrolled-${theme}`);

      await section.getByRole("radio", { name: "Side by side" }).click();
      await highlighted(section);
      await shot(section, `typescript-split-${theme}`);

      // Each side scrolls on its own, here the right one.
      const box = (await scroller.boundingBox())!;
      await page.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2);
      await page.mouse.wheel(300, 0);
      await expect
        .poll(() => scroller.evaluate((el) => el.style.getPropertyValue("--diff-x-new")))
        .toBe("-300px");
      await shot(section, `typescript-split-scrolled-${theme}`);

      await pick(section, "Sample diff", "Rust (renamed)");
      await highlighted(section);
      await shot(section, `rust-split-${theme}`);

      await section.getByRole("radio", { name: "Unified" }).click();
      await pick(section, "Sample diff", "Added");
      await highlighted(section);
      await shot(section, `added-unified-${theme}`);

      await pick(section, "Sample diff", "20k lines");
      await highlighted(section);
      await scroller.evaluate((el) => (el.scrollTop = el.scrollHeight / 2));
      await highlighted(section);
      await shot(section, `large-unified-${theme}`);
    });

    test("line selection", async ({ page }) => {
      const section = await openSection(page, theme);
      await highlighted(section);
      const gutter = (key: string) => section.locator(`[data-line-key="${key}"]`);
      // A selected line, a dragged range across a change block, a hovered unselected line.
      await gutter("0:1").click();
      await gutter("1:2").hover();
      await page.mouse.down();
      await gutter("1:4").hover();
      await page.mouse.up();
      await gutter("0:3").hover();
      await shot(section, `selection-unified-${theme}`);

      await section.getByRole("radio", { name: "Side by side" }).click();
      await highlighted(section);
      await gutter("1:7").hover();
      await shot(section, `selection-split-${theme}`);
    });

    test("images and states", async ({ page }) => {
      const section = await openSection(page, theme);
      // Image sizes appear once both images have loaded.
      const loaded = section.locator("figcaption", { hasText: "×" });
      await pick(section, "Sample diff", "SVG");
      await expect(loaded).toHaveCount(2);
      await highlighted(section);
      await shot(section, `svg-${theme}`);

      for (const [name, file] of [
        ["PNG", "png"],
        ["Binary", "binary"],
        ["Too large", "too-large"],
        ["Mode only", "mode-only"],
      ] as const) {
        await pick(section, "Sample diff", name);
        if (name === "PNG") await expect(loaded).toHaveCount(2);
        await shot(section, `${file}-${theme}`);
      }

      await pick(section, "Sample diff", "TypeScript");
      await pick(section, "State", "Loading");
      await shot(section, `loading-${theme}`);
      await pick(section, "State", "Error");
      await shot(section, `error-${theme}`);
    });
  });
}
