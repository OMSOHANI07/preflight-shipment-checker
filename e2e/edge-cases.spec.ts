/** Uploads Edge_Case_Test_Data.xlsx through the real UI. Titles start with "[Edge]" for the report. */
import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const FILE = path.resolve(__dirname, "../data/edge/Edge_Case_Test_Data.xlsx");

async function uploadEdge(page: Page) {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name: "Edge_Case_Test_Data.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: fs.readFileSync(FILE) });
  await expect(page.getByTestId("summary")).toBeVisible({ timeout: 40_000 });
  await expect(page.locator("ol[aria-live=polite]")).toHaveCount(0);
}
const stat = async (page: Page, label: string) =>
  Number((await page.getByTestId("summary").getByText(label, { exact: true }).locator("..").innerText()).match(/\d+/)?.[0]);
async function open(page: Page, id: string) {
  const card = page.locator(`article#${id}`);
  await page.getByPlaceholder("Search Booking ID or seller").fill(id);
  const t = card.locator("button[aria-expanded]").first();
  if ((await t.getAttribute("aria-expanded")) !== "true") await t.click();
  return card;
}

test.describe("[Edge] Edge-case workbook in the browser", () => {
  test("[Edge] summary: 76 bookings, grey row skipped, orphan EC-99 reported", async ({ page }) => {
    await uploadEdge(page);
    await expect(page.getByTestId("summary").getByText("Total bookings").locator("..")).toContainText("76", { timeout: 10_000 });
    await page.waitForTimeout(1500); // count-up animation
    const [red, inc, amber, green] = [await stat(page, "Red"), await stat(page, "Incomplete"), await stat(page, "Amber"), await stat(page, "Green")];
    expect([inc, amber]).toEqual([15, 7]);
    // AI may confirm the Bluetooth speaker (EC-28) has a lithium battery: Green 33 → 32, Red 21 → 22
    expect(red + green).toBe(54);
    expect([21, 22]).toContain(red);
    await expect(page.getByText(/Skipped the template's grey example row/)).toBeVisible();
    await expect(page.getByText(/EC-99 on the Items sheet does not exist/)).toBeVisible();
  });
  test("[Edge] HTML in a description is shown as text, never run", async ({ page }) => {
    let dialog = false;
    page.on("dialog", (d) => { dialog = true; void d.dismiss(); });
    await uploadEdge(page);
    const card = await open(page, "EC-72");
    await expect(card.locator("td", { hasText: "<script>alert(1)</script> Café mug – ü, 350 ml" })).toBeVisible();
    expect(await page.locator("script:not([src])", { hasText: "alert(1)" }).count()).toBe(0);
    expect(dialog).toBe(false);
  });
  test("[Edge] prompt injection in a description doesn't change the result", async ({ page }) => {
    await uploadEdge(page);
    const card = await open(page, "EC-73");
    await expect(card.getByText("Red", { exact: true }).first()).toBeVisible();
    await expect(card.getByText("R-01", { exact: true }).first()).toBeVisible();
    await expect(card.getByRole("button", { name: /Confirm booking/ })).toBeDisabled();
  });
  test("[Edge] formula-looking seller name stays plain text", async ({ page }) => {
    await uploadEdge(page);
    const card = await open(page, "EC-74");
    await expect(card).toContainText('=HYPERLINK("http://evil.example","Click me")');
    await expect(card.locator('a[href*="evil.example"]')).toHaveCount(0);
  });
  test("[Edge] 25-item booking renders and confirms", async ({ page }) => {
    await uploadEdge(page);
    const card = await open(page, "EC-67");
    await expect(card.locator("tbody tr")).toHaveCount(25 + 1 + 10); // 25 item rows + 1 booking row + 10 rule rows
    await card.getByRole("button", { name: /Confirm booking/ }).click();
    await expect(card.getByText(/Booking confirmed — reference PF-/)).toBeVisible({ timeout: 15_000 });
  });
  test("[Edge] fixed parsing cases show GREEN: date+time, decimal comma, float noise, ID case", async ({ page }) => {
    await uploadEdge(page);
    for (const id of ["EC-46", "EC-53", "EC-54", "EC-63"]) {
      const card = await open(page, id);
      await expect(card.getByText("Green", { exact: true }).first()).toBeVisible();
    }
  });
  test("[Edge] false-positive traps are not Red: perfume-free, lithium grease, SKU-only keyword", async ({ page }) => {
    await uploadEdge(page);
    for (const id of ["EC-29", "EC-30", "EC-31"]) {
      const card = await open(page, id);
      await expect(card.locator("section[aria-label=Issues] > ul").getByText("R-06", { exact: true })).toHaveCount(0);
      await expect(card.locator("tr", { hasText: "No lithium batteries" })).toContainText("Pass");
    }
  });
  test("[Edge] understated gross weight shows tip A-10", async ({ page }) => {
    await uploadEdge(page);
    const card = await open(page, "EC-35");
    await card.locator("details").filter({ hasText: /Tips \(/ }).locator("summary").click();
    await expect(card).toContainText("A-10");
    await expect(card).toContainText("540 kg per pallet");
  });
});

test.describe("[Edge] Clearer messages", () => {
  test("[Edge] unreadable dates explain why (US order, impossible date)", async ({ page }) => {
    await uploadEdge(page);
    await expect(await open(page, "EC-44")).toContainText("Did you mean 15-12-2026?");
    await expect(await open(page, "EC-45")).toContainText("February doesn't have 31 days");
  });
  test("[Edge] scientific-notation HS code and all-zero HS code are explained", async ({ page }) => {
    await uploadEdge(page);
    await expect(await open(page, "EC-07")).toContainText("Excel turned it into scientific notation");
    const c = await open(page, "EC-08");
    await c.locator("details").filter({ hasText: /Tips \(/ }).locator("summary").click();
    await expect(c).toContainText("A-11");
  });
  test("[Edge] a 300-character description wraps instead of stretching the table", async ({ page }) => {
    await uploadEdge(page);
    const c = await open(page, "EC-75");
    const cell = c.locator("td", { hasText: "Hand-glazed stoneware coffee mug" }).first();
    const w = await cell.evaluate((e) => e.getBoundingClientRect().width);
    expect(w).toBeLessThanOrEqual(26 * 16 + 1);
    await expect(c.locator("section[aria-label=Confirmation] p").first()).toContainText("…");
  });
});
