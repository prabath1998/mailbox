import { expect, test } from "@playwright/test";
import { clearInbox, extract, waitForEmail } from "./mailbox";

test.beforeEach(async () => {
  await clearInbox();
});

test("new users confirm their email address", async ({ page }) => {
  const email = `ana+${Date.now()}@example.com`;

  await page.goto("/register");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("correct horse battery staple");
  await page.getByRole("button", { name: "Create account" }).click();

  const message = await waitForEmail(`to:${email} subject:confirm`);
  expect(message.from.address).toBe("hello@acme.dev");

  const { links } = await extract(message);
  const confirm = links.find((l) => l.text.toLowerCase().includes("confirm"));
  expect(confirm, "confirmation link").toBeDefined();

  await page.goto(confirm!.url);
  await expect(page.getByText("Email confirmed")).toBeVisible();
});

test("two-factor login with a one-time code", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("ana@example.com");
  await page.getByLabel("Password").fill("correct horse battery staple");
  await page.getByRole("button", { name: "Log in" }).click();

  const message = await waitForEmail("to:ana@example.com subject:code");
  const { codes } = await extract(message);

  await page.getByLabel("Code").fill(codes[0]);
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).toHaveURL(/dashboard/);
});
