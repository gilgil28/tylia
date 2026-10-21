// Credential prompts (the askpass bridge) in browser mode: the mock raises prompts through
// `window.__tyliaAskpass` (src/ipc/mock/askpass.ts). Also writes screenshots of the dialogs
// for review against docs/DESIGN.md §4.13.

import { expect, test, type Page } from "@playwright/test";

interface MockAskpass {
  listening(): boolean;
  raise(prompt: Record<string, unknown>): Promise<string | null>;
  close(id: number): void;
}
type MockWindow = Window & { __tyliaAskpass?: MockAskpass };

const PASSWORD = {
  kind: "password",
  prompt: "Password for 'https://ada@github.com': ",
  host: "github.com",
  detail: "ada",
  repo: "/home/ada/code/tylia-demo",
  secret: true,
};
const HOST_KEY = {
  kind: "hostKey",
  prompt:
    "The authenticity of host 'github.com (140.82.121.4)' can't be established.\n" +
    "ED25519 key fingerprint is SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU.\n" +
    "Are you sure you want to continue connecting (yes/no/[fingerprint])? ",
  host: "github.com",
  detail: "SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU",
  repo: "/home/ada/code/tylia-demo",
  secret: false,
};
const USERNAME = {
  kind: "username",
  prompt: "Username for 'https://gitlab.com': ",
  host: "gitlab.com",
  secret: false,
};
const PASSPHRASE = {
  kind: "passphrase",
  prompt: "Enter passphrase for key '/home/ada/.ssh/id_ed25519': ",
  detail: "/home/ada/.ssh/id_ed25519",
  secret: true,
};

async function ready(page: Page, theme = "light") {
  await page.addInitScript(() => localStorage.removeItem("tylia.web.ui"));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/?theme=${theme}&platform=windows`);
  await page.waitForFunction(() => (window as MockWindow).__tyliaAskpass?.listening() === true);
}

/** Raises a prompt; the returned promise settles with the answer (null = cancelled). */
function raise(page: Page, prompt: Record<string, unknown>): Promise<string | null> {
  return page.evaluate((p) => (window as MockWindow).__tyliaAskpass!.raise(p), prompt);
}

test("password prompt submits the typed secret", async ({ page }) => {
  await ready(page);
  const answer = raise(page, PASSWORD);
  const dialog = page.getByRole("dialog", { name: "Sign in to github.com" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Enter the password for ada on github.com.")).toBeVisible();
  await expect(dialog.getByText(/personal access token/)).toBeVisible();
  await expect(dialog.getByText("Repository: tylia-demo")).toBeVisible();

  const field = dialog.getByLabel("Password", { exact: true });
  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute("type", "password");
  await field.fill("ghp_example");
  await dialog.getByRole("button", { name: "Show" }).click();
  await expect(field).toHaveAttribute("type", "text");
  await field.press("Enter");

  expect(await answer).toBe("ghp_example");
  await expect(dialog).toBeHidden();
});

test("host-key prompt defaults to cancel", async ({ page }) => {
  await ready(page);

  let answer = raise(page, HOST_KEY);
  let dialog = page.getByRole("dialog", { name: "Unknown host" });
  await expect(dialog.getByText(HOST_KEY.detail)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Enter");
  expect(await answer).toBeNull();
  await expect(dialog).toBeHidden();

  answer = raise(page, HOST_KEY);
  dialog = page.getByRole("dialog", { name: "Unknown host" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  expect(await answer).toBeNull();
  await expect(dialog).toBeHidden();

  answer = raise(page, HOST_KEY);
  await page.getByRole("button", { name: "Trust and connect" }).click();
  expect(await answer).toBe("yes");
});

test("prompts queue and show one at a time", async ({ page }) => {
  await ready(page);
  const first = raise(page, USERNAME);
  await expect(page.getByRole("dialog", { name: "Sign in to gitlab.com" })).toBeVisible();
  const second = raise(page, PASSWORD);
  const third = raise(page, PASSPHRASE);
  await expect(page.getByText("2 more requests waiting")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);

  // The second prompt's operation ends while it waits: it never shows.
  await page.evaluate(() => (window as MockWindow).__tyliaAskpass!.close(2));
  expect(await second).toBeNull();
  await expect(page.getByText("1 more request waiting")).toBeVisible();

  const username = page.getByLabel("Username", { exact: true });
  await expect(username).toHaveAttribute("type", "text");
  await username.fill("ada");
  await page.getByRole("button", { name: "Sign in" }).click();
  expect(await first).toBe("ada");

  const unlock = page.getByRole("dialog", { name: "Unlock SSH key" });
  await expect(unlock).toBeVisible();
  // Nothing typed into the previous prompt carries over.
  const passphrase = unlock.getByLabel("Passphrase", { exact: true });
  await expect(passphrase).toHaveValue("");
  await passphrase.fill("correct horse");
  await passphrase.press("Enter");
  expect(await third).toBe("correct horse");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

for (const theme of ["light", "dark"]) {
  test(`askpass dialogs screenshots ${theme}`, async ({ page }) => {
    await ready(page, theme);
    await page.evaluate(() => document.fonts.ready);
    const shot = (name: string) =>
      page.screenshot({
        path: `e2e/__screenshots__/askpass-${name}-${theme}.png`,
        animations: "disabled",
      });

    const shots: [Record<string, unknown>, string, string][] = [
      [PASSWORD, "Sign in to github.com", "password"],
      [HOST_KEY, "Unknown host", "host-key"],
      [PASSPHRASE, "Unlock SSH key", "passphrase"],
    ];
    for (const [prompt, title, name] of shots) {
      const answer = raise(page, prompt);
      await expect(page.getByRole("dialog", { name: title })).toBeVisible();
      if (prompt.secret) await page.getByRole("dialog").locator("input").fill("ghp_example");
      await shot(name);
      await page.keyboard.press("Escape");
      expect(await answer).toBeNull();
    }
  });
}
