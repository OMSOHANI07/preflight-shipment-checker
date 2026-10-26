/**
 * V2 Conversation (Chat + Voice) in a real browser. The local server runs with GEMINI_MOCK=1, so the
 * demo messages map to fixed extractions and every run is the same. Titles start with "[V2 …]".
 * Against production (E2E_BASE_URL) only the tests that don't depend on mocked Gemini run.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { DEMO_SCRIPT } from "../lib/conversation/demo";

const LIVE = !!process.env.E2E_BASE_URL;
const VAGUE = DEMO_SCRIPT.map(([m]) => m);
const TO_REVIEW = ["Carry on without one", "No budget limit"];

async function openChat(page: Page) {
  await page.goto("/");
  await page.getByRole("tab", { name: "Conversation" }).click();
  await expect(page.getByTestId("messages")).toBeVisible({ timeout: 15_000 });
}
const assistant = (page: Page) => page.locator('[data-testid=messages] [data-role="assistant"]');
async function send(page: Page, text: string) {
  const before = await assistant(page).count();
  await page.locator("#chat-input").fill(text);
  await page.locator("#chat-input").press("Enter");
  await expect(assistant(page)).toHaveCount(before + 1, { timeout: 20_000 });
  return (await assistant(page).last().innerText()).trim();
}
async function sendAll(page: Page, msgs: string[]) {
  for (const m of msgs) await send(page, m);
}
const panel = (page: Page) => page.getByRole("complementary", { name: "Booking summary" });

test.describe("[V2 Chat] conversation booking", () => {
  test.skip(LIVE, "needs GEMINI_MOCK=1");

  test("[V2 Chat] §7.1 vague seller → AMBER review → confirm anyway → booked, purchase order and corrected Excel download", async ({ page }) => {
    await openChat(page);
    await expect(page.getByRole("tab", { name: "Chat" })).toHaveAttribute("aria-selected", "true");
    const first = await send(page, VAGUE[0]);
    expect(first).toMatch(/could be any day from Monday 02-11-2026 to Friday 06-11-2026/);
    await sendAll(page, VAGUE.slice(1));
    await sendAll(page, TO_REVIEW);
    await expect(page.getByTestId("review-card")).toBeVisible();
    await expect(panel(page)).toContainText("Check first");
    await expect(panel(page)).toContainText("Carrier A");
    await expect(assistant(page).last()).toContainText("R-08");
    await page.getByRole("button", { name: "Confirm anyway" }).click();
    await expect(assistant(page).last()).toContainText(/Booked! Reference PF-/, { timeout: 20_000 });
    await expect(page.getByTestId("review-card")).toContainText(/Booking confirmed — reference PF-/);
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("review-card").getByTestId("download-po").click()]);
    expect(dl.suggestedFilename()).toMatch(/^Purchase_Order_BK-CHAT-.*\.pdf$/);
    // the chips after booking download too
    const [po] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Purchase order (PDF)" }).first().click()]);
    expect(po.suggestedFilename()).toMatch(/\.pdf$/);
    const [xl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Corrected Excel" }).first().click()]);
    expect(xl.suggestedFilename()).toMatch(/^Corrected_BK-CHAT-.*\.xlsx$/);
  });

  test("[V2 Chat] §7.2 add a pallet: diff toast, panel highlight, Undo, refresh starts fresh", async ({ page }) => {
    await openChat(page);
    await sendAll(page, [...VAGUE, ...TO_REVIEW]);
    const heavy = await send(page, "Actually the total weight is 1,600 kg.");
    expect(heavy).toMatch(/Carrier A only takes 500 kg/);
    await expect(page.getByTestId("diff-toast")).toContainText("R-05");
    await expect(page.getByRole("button", { name: "Use 4 pallets" })).toBeVisible();

    await send(page, "add a pallet then");
    // the changed row flashes for a few seconds — check it first
    await expect(panel(page).locator("[data-field=pallets]")).toHaveClass(/blue-tint/);
    await expect(panel(page).locator("[data-field=pallets]")).toContainText("4");
    await expect(page.getByTestId("diff-toast")).toContainText("R-05 fixed");
    await expect(page.getByTestId("diff-toast")).toContainText("£660.00 → £720.00");

    await page.getByRole("button", { name: "Undo last change" }).click();
    await expect(assistant(page).last()).toContainText("Undone");
    await expect(panel(page).locator("[data-field=pallets]")).toContainText("3");

    // chats are not kept: a refresh starts a new conversation
    await page.reload();
    await page.getByRole("tab", { name: "Conversation" }).click();
    await expect(page.locator('[data-testid=messages] [data-role]')).toHaveCount(1);
    expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => /conversation/i.test(k)))).toEqual([]);
  });

  test("[V2 Chat] plain 'confirm' on AMBER asks first; Start over clears", async ({ page }) => {
    await openChat(page);
    await sendAll(page, [...VAGUE, ...TO_REVIEW]);
    expect(await send(page, "confirm")).toMatch(/Confirm anyway\?/);
    await page.getByRole("button", { name: "Start over" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Start over" }).click();
    await expect(page.locator('[data-testid=messages] [data-role]')).toHaveCount(1);
    await expect(page.getByTestId("review-card")).toHaveCount(0);
  });

  test("[V2 Chat] messages are shown as text, never as HTML", async ({ page }) => {
    await openChat(page);
    await send(page, '<img src=x onerror="window.__xss=1"> <b>bold</b>');
    await expect(page.locator('[data-testid=messages] [data-role="seller"]').last()).toContainText("<b>bold</b>");
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  });
});

test.describe("[V2 Voice] ElevenLabs agent", () => {
  /** A fake microphone so the permission step succeeds in headless Chromium. */
  const fakeMic = (page: Page) => page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => new MediaStream(), enumerateDevices: async () => [] } });
  });

  test("[V2 Voice] the page asks our server for a token (never the key) and explains when voice isn't set up", async ({ page }) => {
    await fakeMic(page);
    let asked = false;
    await page.route("**/api/voice/token", (r) => { asked = true; return r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Voice isn't set up on this site yet.", kind: "not_configured" }) }); });
    await openChat(page);
    await page.getByRole("tab", { name: "Voice" }).click();
    await expect(page.getByTestId("voice-status")).toHaveText("Tap to talk");
    await page.getByTestId("mic").click();
    await expect(page.getByTestId("voice-problem")).toHaveText("Voice isn't set up on this site yet.");
    expect(asked).toBe(true);
    await page.getByRole("button", { name: "Switch to Chat" }).click();
    await expect(page.locator("#chat-input")).toBeVisible();
  });

  test("[V2 Voice] invalid key / unreachable service is shown plainly", async ({ page }) => {
    await fakeMic(page);
    await page.route("**/api/voice/token", (r) => r.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "The voice service rejected this site's credentials.", kind: "rejected" }) }));
    await openChat(page);
    await page.getByRole("tab", { name: "Voice" }).click();
    await page.getByTestId("mic").click();
    await expect(page.getByTestId("voice-problem")).toContainText("rejected this site's credentials");
  });

  test("[V2 Voice] microphone denied → explains how to allow it, Try again and Switch to Chat", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => { throw new DOMException("denied", "NotAllowedError"); } } });
    });
    await openChat(page);
    await page.getByRole("tab", { name: "Voice" }).click();
    await page.getByTestId("mic").click();
    await expect(page.getByTestId("voice-unsupported")).toContainText("The microphone is blocked");
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    await page.getByRole("button", { name: "Switch to Chat" }).click();
    await expect(page.getByRole("tab", { name: "Chat" })).toHaveAttribute("aria-selected", "true");
  });

  test("[V2 Voice] no microphone API → Switch to Chat", async ({ page }) => {
    await page.addInitScript(() => { Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined }); });
    await openChat(page);
    await page.getByRole("tab", { name: "Voice" }).click();
    await expect(page.getByTestId("voice-unsupported")).toContainText("isn't supported");
  });

  test("[V2 Voice] typing on the Voice tab without a call still books through the same engine", async ({ page }) => {
    test.skip(LIVE, "needs GEMINI_MOCK=1");
    await openChat(page);
    await page.getByRole("tab", { name: "Voice" }).click();
    await page.locator("#voice-type").fill(VAGUE[0]);
    await page.locator("#voice-type").press("Enter");
    await expect(panel(page).locator("[data-field=route]")).toContainText("Frankfurt", { timeout: 20_000 });
  });
});

test.describe("[V2 A11y] conversation tab", () => {
  test("[V2 A11y] no serious axe violations in Chat", async ({ page }) => {
    await openChat(page);
    const r = await new AxeBuilder({ page }).include("#panel-conversation").analyze();
    expect(r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
  });
});
