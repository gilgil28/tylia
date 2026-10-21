// The screenshots in the README (docs/screenshots/) and on the website (website/assets/),
// rendered at 2× in both themes: `pnpm shots:publish`. Not part of `pnpm shots`, because
// it overwrites committed images. The website also gets WebP copies, encoded by Chromium.

import { writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const THEMES = ["light", "dark"] as const;
const VIEWPORT = { width: 1280, height: 800 };

async function open(page: Page, theme: string) {
  await page.addInitScript(() => localStorage.removeItem("tylia.web.ui"));
  await page.setViewportSize(VIEWPORT);
  await page.goto(`/?theme=${theme}&platform=windows&repo=demo`);
  await page.evaluate(() => document.fonts.ready);
}

async function publish(page: Page, name: string) {
  // Let the diff's syntax highlighting arrive from its worker.
  await page.waitForTimeout(400);
  const png = await page.screenshot({ animations: "disabled" });
  const webp = await page.evaluate(async (b64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${b64}`;
    await image.decode();
    const canvas = new OffscreenCanvas(image.width, image.height);
    canvas.getContext("2d")!.drawImage(image, 0, 0);
    const blob = await canvas.convertToBlob({ type: "image/webp", quality: 0.9 });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }, png.toString("base64"));
  writeFileSync(`docs/screenshots/${name}.png`, png);
  writeFileSync(`website/assets/${name}.png`, png);
  writeFileSync(`website/assets/${name}.webp`, Buffer.from(webp, "base64"));
}

for (const theme of THEMES) {
  test(`history ${theme}`, async ({ page }) => {
    await open(page, theme);
    await page.getByText("Make edge width configurable").first().click();
    await expect(page.getByRole("heading", { name: "Make edge width configurable" })).toBeVisible();
    await publish(page, `history-${theme}`);
  });

  test(`changes ${theme}`, async ({ page }) => {
    await open(page, theme);
    await page.getByRole("button", { name: /^Changes/ }).click();
    await page.getByRole("option", { name: /parser\.rs/ }).click();
    await page
      .getByRole("textbox", { name: "Commit message" })
      .fill("Parse records from git log -z");
    await expect(page.getByText("Unstaged · 2")).toBeVisible();
    await publish(page, `changes-${theme}`);
  });
}
