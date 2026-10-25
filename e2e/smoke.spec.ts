/**
 * Smoke test (prompt §7.3). Run after `npm run build`: npm run e2e
 * Against production: E2E_BASE_URL=https://… npm run e2e
 */
import { expect, test } from "@playwright/test";

test("sample file → summary, RED card blocked, AMBER card needs acknowledgement", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Catch it before it ships." })).toBeVisible();

  // V2 placeholders are visible
  await expect(page.getByRole("tab", { name: /Conversation/ })).toBeVisible();

  await page.getByTestId("use-sample").click();
  const summary = page.getByTestId("summary");
  await expect(summary).toBeVisible({ timeout: 30_000 });
  await expect(summary.getByText("Total bookings").locator("..")).toContainText("16", { timeout: 10_000 });
  await expect(summary.getByText("Red", { exact: true }).locator("..")).toContainText("8");
  await expect(summary.getByText("Incomplete", { exact: true }).locator("..")).toContainText("1");
  await expect(summary.getByText("Amber", { exact: true }).locator("..")).toContainText("5");
  await expect(summary.getByText("Green", { exact: true }).locator("..")).toContainText("2");
  await expect(page.getByText(/Checked against \d{2}-\d{2}-\d{4}/)).toBeVisible();

  // RED card: R-05 overweight pallets
  const red = page.locator("article#BK-T06");
  await red.locator("button[aria-expanded]").first().click();
  await expect(red.getByText("R-05", { exact: true }).first()).toBeVisible();
  await expect(red.getByText("Recommended once fixed").first()).toBeVisible();
  await expect(red.getByRole("button", { name: /Confirm booking/ })).toBeDisabled();

  // AMBER card: confirm only after ticking the acknowledgement
  const amber = page.locator("article#BK-T08");
  await amber.locator("button[aria-expanded]").first().click();
  const confirm = amber.getByRole("button", { name: /Confirm booking/ });
  await expect(confirm).toBeDisabled();
  await amber.getByRole("checkbox", { name: /I understand these warnings/ }).check();
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(amber.getByText(/Booking confirmed — reference PF-/)).toBeVisible({ timeout: 15_000 });
});
