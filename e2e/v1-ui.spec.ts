/**
 * V1 UI cases, run in a real browser. Local: `npm run build && npm run e2e`.
 * Production: E2E_BASE_URL=https://… npm run e2e
 * Test titles start with "[Category]" — the test report groups by it.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";

const TEMPLATE = path.resolve(__dirname, "../data/Case2_Shipment_Booking_Test_Data_Format.xlsx");

async function loadSample(page: Page) {
  await page.goto("/");
  await page.getByTestId("use-sample").click();
  await expect(page.getByTestId("summary")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("ol[aria-live=polite]")).toHaveCount(0); // progress steps have finished fading out
}
async function openCard(page: Page, id: string): Promise<Locator> {
  const card = page.locator(`article#${id}`);
  const toggle = card.locator("button[aria-expanded]").first();
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  return card;
}
const statNow = async (page: Page, label: string) =>
  Number((await page.getByTestId("summary").getByText(label, { exact: true }).locator("..").innerText()).match(/\d+/)?.[0]);
/** Summary numbers count up from 0 — wait until the total has settled before reading. */
async function stat(page: Page, label: string) {
  await expect.poll(async () => { const a = await statNow(page, "Total bookings"); await page.waitForTimeout(300); return a === (await statNow(page, "Total bookings")) && a > 0; }, { timeout: 10_000 }).toBe(true);
  return statNow(page, label);
}
/** The app's own alert (Next.js also renders a hidden route announcer with role="alert"). */
const appAlert = (page: Page) => page.locator("#panel-upload [role=alert]");
async function upload(page: Page, name: string, buffer: Buffer) {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({ name, mimeType: "application/octet-stream", buffer });
}

test.describe("[Page] Home and navigation", () => {
  test("[Page] hero, how-it-works, rules and carriers sections render", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Catch it before it ships." })).toBeVisible();
    await expect(page.locator("#how li")).toHaveCount(3);
    await expect(page.locator("#rules li")).toHaveCount(10);
    await expect(page.locator("#carriers h3")).toHaveText(["Carrier A", "Carrier B", "Carrier C"]);
    await expect(page.locator("#carriers")).toContainText("£180");
    await expect(page.getByRole("link", { name: "GitHub" })).toHaveAttribute("href", /github\.com/);
  });
  test("[Page] Download template serves the Excel template", async ({ page, request }) => {
    await page.goto("/");
    const href = await page.getByRole("link", { name: /Download template/ }).first().getAttribute("href");
    const res = await request.get(href!);
    expect(res.status()).toBe(200);
    expect((await res.body()).subarray(0, 2).toString()).toBe("PK"); // xlsx = zip
  });
  test("[Page] Conversation tab is live: Chat and Voice enabled, no 'Coming in V2' badge", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("tab", { name: /Conversation/ })).not.toContainText("V2");
    await page.getByRole("tab", { name: /Conversation/ }).click();
    const panel = page.locator("#panel-conversation");
    await expect(panel.getByRole("tab", { name: "Chat" })).toHaveAttribute("aria-selected", "true");
    await expect(panel.getByRole("tab", { name: "Voice" })).toBeEnabled();
    await expect(panel).not.toContainText("Coming in V2");
    await expect(panel.locator("#chat-input")).toBeVisible();
  });
  test("[Page] 'Check a file' returns to the upload tab", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("tab", { name: /Conversation/ }).click();
    await page.getByRole("button", { name: "Check a file" }).click();
    await expect(page.locator("#panel-upload")).toBeVisible();
    await expect(page.getByTestId("use-sample")).toBeVisible();
  });
});

test.describe("[Upload] Files", () => {
  test("[Upload] sample file: 16 bookings, totals add up, checked-against date shown", async ({ page }) => {
    await loadSample(page);
    await expect(page.getByTestId("summary").getByText("Total bookings").locator("..")).toContainText("16", { timeout: 10_000 });
    const [red, inc, amber, green] = [await stat(page, "Red"), await stat(page, "Incomplete"), await stat(page, "Amber"), await stat(page, "Green")];
    expect(red + inc + amber + green).toBe(16);
    expect([inc, amber]).toEqual([1, 5]);
    expect([8, 9]).toContain(red); // 9 when the AI confirms the Bluetooth speaker has a lithium battery
    await expect(page.getByText(/Checked against \d{2}-\d{2}-\d{4} \(UK date\)/)).toBeVisible();
  });
  test("[Upload] 'Try edge cases' loads the 76-booking edge-case file", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("try-edge-cases").click();
    await expect(page.getByTestId("summary").getByText("Total bookings").locator("..")).toContainText("76", { timeout: 40_000 });
  });
  test("[Upload] file-level notices: grey example row skipped, orphan item (V-11)", async ({ page }) => {
    await loadSample(page);
    await expect(page.getByText(/Skipped the template's grey example row/)).toBeVisible();
    await expect(page.getByText(/BK-T99 on the Items sheet does not exist/)).toBeVisible();
  });
  test("[Upload] original template: example checked as demo → BK-001 GREEN, Carrier A £540.00", async ({ page }) => {
    await upload(page, "Case2_Shipment_Booking_Test_Data_Format.xlsx", fs.readFileSync(TEMPLATE));
    await expect(page.getByText(/only has the template's grey example row/)).toBeVisible({ timeout: 30_000 });
    const card = await openCard(page, "BK-001");
    await expect(card).toContainText("Green");
    await expect(card).toContainText("Carrier A");
    await expect(card).toContainText("£540.00");
    await expect(card.getByRole("button", { name: /Confirm booking/ })).toBeEnabled();
  });
  test("[Upload] a non-Excel file is rejected with a clear message", async ({ page }) => {
    await upload(page, "bookings.csv", Buffer.from("Booking ID,Seller\nBK-1,Acme"));
    await expect(appAlert(page)).toContainText("isn't an Excel file");
  });
  test("[Upload] a workbook with one sheet is rejected (needs Bookings and Items)", async ({ page }) => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Booking ID"], ["BK-1"]]), "Bookings");
    await upload(page, "one-sheet.xlsx", Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" })));
    await expect(appAlert(page)).toContainText("needs two sheets");
  });
  test("[Upload] missing column is reported and bookings become Incomplete", async ({ page }) => {
    const wb = XLSX.utils.book_new();
    const bh = ["Booking ID", "Seller name", "Origin city", "Origin country", "Destination city", "Destination country", "Destination type", "Ready to ship date", "Seller priority", "Cartons", "Total declared value", "Currency", "Total gross weight (kg)", "Delivery appointment booked"];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([bh, ["BK-1", "Acme", "Leeds", "United Kingdom", "Paris", "France", "Warehouse", "12-01-2027", "Cheapest", 90, 5400, "GBP", 620, "Yes"]]), "Bookings");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Booking ID", "SKU", "Description", "HS code", "Quantity (units)", "Unit price", "Units per carton", "Cartons", "Unit weight (kg)", "Country of origin"], ["BK-1", "MUG-01", "Ceramic coffee mug", 691200, 1080, 5, 12, 90, 0.5, "United Kingdom"]]), "Items");
    await upload(page, "no-pallets.xlsx", Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" })));
    await expect(page.getByText(/Column not found on the Bookings sheet: Pallets/)).toBeVisible({ timeout: 30_000 });
    await expect(await stat(page, "Incomplete")).toBe(1);
  });
});

test.describe("[Results] Summary, filters and cards", () => {
  test("[Results] rule heat-strip lists R-01 … R-10", async ({ page }) => {
    await loadSample(page);
    for (const id of ["R-01", "R-05", "R-10"]) await expect(page.getByLabel(new RegExp(`^${id}: \\d+ booking`))).toBeVisible();
  });
  test("[Results] status filter shows only that status", async ({ page }) => {
    await loadSample(page);
    await page.getByRole("radio", { name: /^Amber/ }).click();
    await expect(page.locator("article")).toHaveCount(5);
    await expect(page.locator("article").first()).toContainText("Amber");
  });
  test("[Results] search by Booking ID and by seller", async ({ page }) => {
    await loadSample(page);
    await page.getByPlaceholder("Search Booking ID or seller").fill("BK-T09");
    await expect(page.locator("article")).toHaveCount(1);
    await page.getByPlaceholder("Search Booking ID or seller").fill("ironbridge");
    await expect(page.locator("article#BK-T15")).toBeVisible();
  });
  test("[Results] cards are ordered Red → Incomplete → Amber → Green", async ({ page }) => {
    await loadSample(page);
    const labels = await page.locator("article header, article h3 .chip").allInnerTexts();
    const order = labels.map((l) => ["Red", "Incomplete", "Amber", "Green"].indexOf(l.trim())).filter((n) => n >= 0);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
  test("[Results] each issue shows rule, severity, numbers and a fix", async ({ page }) => {
    await loadSample(page);
    const card = await openCard(page, "BK-T03");
    await expect(card.getByText("R-02", { exact: true }).first()).toBeVisible();
    await expect(card).toContainText("Red · blocking");
    await expect(card).toContainText("Declared value is £5,000.00 but the items add up to £5,400.00");
    await expect(card).toContainText("Change the total declared value to £5,400.00.");
  });
  test("[Results] 'Show cells' highlights the exact spreadsheet cell", async ({ page }) => {
    await loadSample(page);
    const card = await openCard(page, "BK-T02");
    await card.getByRole("button", { name: /R-01 HS code missing or too short/ }).click();
    await expect(card.locator('td[id$="i:0:hsCodeRaw"]')).toHaveClass(/cell-focus/);
    await expect(card.locator('td[id$="i:0:hsCodeRaw"]')).toHaveAttribute("title", /R-01/);
  });
  test("[Results] rule table: the many-errors booking fails 9 rules", async ({ page }) => {
    await loadSample(page);
    const card = await openCard(page, "BK-T12");
    await expect(card.locator("table").first().getByText("Fail", { exact: true })).toHaveCount(9);
  });
  test("[Results] tips are separate and collapsed", async ({ page }) => {
    await loadSample(page);
    const card = await openCard(page, "BK-T14"); // made in China → duty tip A-02
    const tips = card.locator("details").filter({ hasText: /Tips \(/ });
    await expect(tips).not.toHaveAttribute("open", "");
    await tips.locator("summary").click();
    await expect(tips).toContainText("A-02");
    await expect(card).toContainText("Amber"); // tips never change the status
  });
});

test.describe("[Booking] Status rules and confirmation", () => {
  test("[Booking] RED: R-05 shown, 'Recommended once fixed', Confirm locked with reason", async ({ page }) => {
    await loadSample(page);
    const card = await openCard(page, "BK-T06");
    await expect(card.getByText("R-05", { exact: true }).first()).toBeVisible();
    await expect(card.getByText("Recommended once fixed").first()).toBeVisible();
    await expect(card.getByRole("button", { name: /Confirm booking/ })).toBeDisabled();
    await expect(card).toContainText("Fix the Red issues first");
  });
  test("[Booking] INCOMPLETE: missing pallets, R-05 not evaluable, Confirm locked", async ({ page }) => {
    await loadSample(page);
    const card = await openCard(page, "BK-T13");
    await expect(card).toContainText("Pallets missing");
    // A rule that can't be checked yet shows "—", never a tick
    await expect(card.locator("tr", { hasText: "Weight per pallet" }).locator("td").last()).toHaveText(/—/);
    await expect(card.locator("tr", { hasText: "Weight per pallet" })).not.toContainText("Pass");
    await expect(card.getByRole("button", { name: /Confirm booking/ })).toBeDisabled();
  });
  test("[Booking] AMBER: needs 'I understand these warnings' before confirming", async ({ page }) => {
    await loadSample(page);
    const card = await openCard(page, "BK-T08");
    const confirm = card.getByRole("button", { name: /Confirm booking/ });
    await expect(confirm).toBeDisabled();
    await card.getByRole("checkbox", { name: /I understand these warnings/ }).check();
    await confirm.click();
    await expect(card.getByText(/Booking confirmed — reference PF-\d{6}-[0-9A-F]{6}/)).toBeVisible({ timeout: 15_000 });
  });
  test("[Booking] GREEN: confirms directly with a reference number", async ({ page }) => {
    await loadSample(page);
    const card = await openCard(page, "BK-T01");
    await card.getByRole("button", { name: /Confirm booking/ }).click();
    await expect(card.getByText(/Booking confirmed — reference PF-/)).toBeVisible({ timeout: 15_000 });
  });
  test("[Booking] overweight for every carrier: 'No carrier fits'", async ({ page }) => {
    await loadSample(page);
    const card = await openCard(page, "BK-T15");
    await expect(card.getByText("No carrier fits").first()).toBeVisible();
    // Confirmation (AI or fallback wording) must carry the engine's fact: 800 kg per pallet is too heavy.
    await expect(card.locator("section[aria-label=Confirmation] p").first()).toContainText(/800 kg/);
    await expect(card.getByRole("button", { name: /Confirm booking/ })).toBeDisabled();
  });
  test("[Booking] carrier card: cost, transit, dates, reason, trade-off and all 3 options", async ({ page }) => {
    await loadSample(page);
    const card = await openCard(page, "BK-T01");
    for (const t of ["Cost", "Transit", "On time", "Collection", "Est. delivery", "Why:", "Trade-off:"]) await expect(card.getByText(t, { exact: false }).first()).toBeVisible();
    await expect(card.getByText("All options on this route")).toBeVisible();
    await expect(card.getByText("All options on this route").locator("..").locator(".grid > div")).toHaveCount(3);
  });
  test("[Booking] confirmation paragraph, next steps and invoice checklist", async ({ page }) => {
    await loadSample(page);
    const card = await openCard(page, "BK-T01");
    await expect(card).toContainText(/3 pallets \(90 cartons of ceramic coffee mug, 350 ml, £5,400.00\)/);
    await expect(card.getByText("What happens next")).toBeVisible();
    await card.getByText("Commercial invoice checklist").click();
    await expect(card.getByText("Incoterms agreed with the buyer")).toBeVisible();
  });
});

test.describe("[Export] PDF and share link", () => {
  test("[Export] booking PDF downloads and is a real PDF", async ({ page }) => {
    await loadSample(page);
    const card = await openCard(page, "BK-T01");
    const [dl] = await Promise.all([page.waitForEvent("download"), card.getByRole("button", { name: /Download PDF/ }).click()]);
    expect(dl.suggestedFilename()).toBe("preflight-BK-T01.pdf");
    const buf = fs.readFileSync((await dl.path())!);
    expect(buf.subarray(0, 4).toString()).toBe("%PDF");
    expect(buf.length).toBeGreaterThan(10_000);
    expect(buf.toString("latin1")).toMatch(/\/FontFile2/); // Unicode font embedded (£, é, ü, – print correctly)
  });
  test("[Export] full report PDF covers every booking", async ({ page }) => {
    await loadSample(page);
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Full report PDF/ }).click()]);
    const buf = fs.readFileSync((await dl.path())!);
    expect(buf.subarray(0, 4).toString()).toBe("%PDF");
    expect((buf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThan(16);
  });
  test("[Export] share link opens the saved results and the booking", async ({ page, context }) => {
    test.skip(!!process.env.E2E_NO_DB, "sharing needs the database");
    await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => undefined);
    await loadSample(page);
    const copy = page.getByRole("button", { name: /Copy results link/ });
    await expect(copy).toBeEnabled({ timeout: 20_000 });
    await copy.click();
    const url = await page.evaluate(() => navigator.clipboard.readText());
    expect(url).toMatch(/\/results\/[0-9a-f-]{36}$/);
    await page.goto(`${url}#BK-T12`);
    await expect(page.getByText("Shared results")).toBeVisible();
    await expect(page.locator("article#BK-T12 button[aria-expanded]").first()).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("article#BK-T12")).toBeInViewport({ timeout: 5_000 });
  });
  test("[Export] unknown results link shows a friendly message", async ({ page }) => {
    await page.goto("/results/00000000-0000-0000-0000-000000000000");
    await expect(page.getByText("We couldn't find these results.")).toBeVisible();
  });
});

test.describe("[Quality] Responsive, themes, accessibility", () => {
  test("[Quality] phone width (375px): no horizontal scroll, results readable", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await loadSample(page);
    await openCard(page, "BK-T06");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.evaluate(() => window.scrollTo(400, window.scrollY));
    expect(await page.evaluate(() => window.scrollX)).toBe(0);
  });
  test("[Quality] dark mode follows the system setting", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(0, 0, 0)");
    await page.emulateMedia({ colorScheme: "light" });
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(251, 251, 253)");
  });
  test("[Quality] reduced motion: content is visible without animation", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await loadSample(page);
    await expect(page.getByTestId("summary")).toContainText("16");
  });
  test("[Quality] keyboard: a booking card opens with Enter", async ({ page }) => {
    await loadSample(page);
    const toggle = page.locator("article#BK-T09 button[aria-expanded]").first();
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
  });
  test("[Quality] accessibility: no serious issues on the home page (light + dark)", async ({ page }) => {
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await page.goto("/");
      const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
      const bad = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(bad.map((v) => `${scheme}: ${v.id} (${v.nodes.length}) ${v.nodes[0]?.target}`)).toEqual([]);
    }
  });
  test("[Quality] accessibility: no serious issues on an open booking card", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await loadSample(page);
    await openCard(page, "BK-T12");
    const r = await new AxeBuilder({ page }).include("#app").withTags(["wcag2a", "wcag2aa"]).analyze();
    const bad = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(bad.map((v) => `${v.id} (${v.nodes.length}) ${v.nodes[0]?.target}`)).toEqual([]);
  });
});

test.describe("[Resilience] Database and AI unavailable", () => {
  test("[Resilience] without the database: results still work, sharing explains why it's off", async ({ page }) => {
    test.skip(!process.env.E2E_NO_DB, "only in the no-database run");
    await loadSample(page);
    const copy = page.getByRole("button", { name: /Copy results link/ });
    await page.waitForTimeout(3000);
    await expect(copy).toBeDisabled();
    await copy.locator("..").hover();
    await expect(page.getByText(/database isn't reachable/).first()).toBeVisible();
    const card = await openCard(page, "BK-T01");
    await card.getByRole("button", { name: /Confirm booking/ }).click();
    await expect(card.getByText(/Couldn't save to the database/)).toBeVisible({ timeout: 15_000 });
  });
  test("[Resilience] without AI: explanations come straight from the rule engine", async ({ page }) => {
    test.skip(!process.env.E2E_NO_AI, "only in the no-AI run");
    await loadSample(page);
    await expect(page.getByText(/Explanations are built straight from the rule engine's facts/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/AI restricted-goods check was unavailable/)).toBeVisible();
    const card = await openCard(page, "BK-T16");
    await expect(card).toContainText("A-09");
  });
});
