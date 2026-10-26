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

  test("[V2 Chat] §7.1 vague seller → AMBER review → confirm anyway → booked, PDF downloads", async ({ page }) => {
    await openChat(page);
    await expect(page.getByRole("tab", { name: "Chat" })).toHaveAttribute("aria-selected", "true");
    const first = await send(page, VAGUE[0]);
    expect(first).toMatch(/could be any day from Monday 02-11-2026 to Friday 06-11-2026/);
    await sendAll(page, VAGUE.slice(1));
    await sendAll(page, TO_REVIEW);
    await expect(page.getByTestId("review-card")).toBeVisible();
    await expect(panel(page)).toContainText("Amber");
    await expect(panel(page)).toContainText("Carrier A");
    await expect(assistant(page).last()).toContainText("R-08");
    await page.getByRole("button", { name: "Confirm anyway" }).click();
    await expect(assistant(page).last()).toContainText(/Booked! Reference PF-/, { timeout: 20_000 });
    await expect(page.getByTestId("review-card")).toContainText(/Booking confirmed — reference PF-/);
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("review-card").getByRole("button", { name: /Download PDF/ }).click()]);
    expect(dl.suggestedFilename()).toMatch(/\.pdf$/);
  });

  test("[V2 Chat] §7.2 add a pallet: diff toast, panel highlight, Undo, refresh keeps it", async ({ page }) => {
    await openChat(page);
    await sendAll(page, [...VAGUE, ...TO_REVIEW]);
    const heavy = await send(page, "Actually the total weight is 1,600 kg.");
    expect(heavy).toMatch(/Carrier A only takes 500 kg/);
    await expect(page.getByTestId("diff-toast")).toContainText("R-05");
    await expect(page.getByRole("button", { name: "Use 4 pallets" })).toBeVisible();

    await send(page, "add a pallet then");
    await expect(page.getByTestId("diff-toast")).toContainText("R-05 fixed");
    await expect(page.getByTestId("diff-toast")).toContainText("£660.00 → £720.00");
    await expect(panel(page).locator("[data-field=pallets]")).toContainText("4");
    await expect(panel(page).locator("[data-field=pallets]")).toHaveClass(/blue-tint/);

    await page.getByRole("button", { name: "Undo last change" }).click();
    await expect(assistant(page).last()).toContainText("Undone");
    await expect(panel(page).locator("[data-field=pallets]")).toContainText("3");

    await page.reload();
    await page.getByRole("tab", { name: "Conversation" }).click();
    await expect(assistant(page).last()).toContainText("Undone");
    await expect(panel(page).locator("[data-field=pallets]")).toContainText("3");
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

test.describe("[V2 Voice] push-to-talk", () => {
  test("[V2 Voice] stubbed speech: en-GB, transcript, sends the turn, speaks the reply", async ({ page }) => {
    test.skip(LIVE, "needs GEMINI_MOCK=1");
    await page.addInitScript(() => {
      const w = window as unknown as Record<string, unknown>;
      w.__said = [] as string[];
      w.__heard = "";
      class FakeSR {
        lang = ""; onresult: ((e: unknown) => void) | null = null; onerror: ((e: unknown) => void) | null = null; onend: (() => void) | null = null;
        start() {
          w.__lang = this.lang;
          const t = w.__heard as string;
          setTimeout(() => {
            const alt = Object.assign([{ transcript: t, confidence: 0.9 }], { isFinal: true });
            this.onresult?.({ resultIndex: 0, results: [alt] });
            this.onend?.();
          }, 200);
        }
        stop() {} abort() {}
      }
      w.SpeechRecognition = FakeSR;
      speechSynthesis.speak = (u: SpeechSynthesisUtterance) => { (w.__said as string[]).push(u.text); setTimeout(() => u.onend?.(new Event("end") as SpeechSynthesisEvent), 50); };
    });
    await openChat(page);
    await page.getByRole("tab", { name: "Voice" }).click();
    await page.evaluate((m) => { (window as unknown as Record<string, unknown>).__heard = m; }, VAGUE[0]);
    await page.getByTestId("mic").click();
    await expect(page.getByTestId("transcript")).toContainText("3 pallets of mugs");
    await expect(page.getByTestId("transcript").getByRole("button", { name: "Edit" })).toBeVisible();
    await expect.poll(() => page.evaluate(() => ((window as unknown as Record<string, string[]>).__said).length), { timeout: 20_000 }).toBe(1);
    const said = await page.evaluate(() => (window as unknown as Record<string, string[]>).__said[0]);
    expect(said).toMatch(/2 November/); // dates are spoken, not read as digits
    expect(said).not.toMatch(/\d{2}-\d{2}-\d{4}/);
    expect(await page.evaluate(() => (window as unknown as Record<string, string>).__lang)).toBe("en-GB");
    await expect(page.getByTestId("mic")).toHaveAttribute("aria-label", "Tap to talk");
    // same conversation in Chat
    await page.getByRole("tab", { name: "Chat" }).click();
    await expect(page.locator('[data-testid=messages] [data-role="seller"]').last()).toContainText("3 pallets of mugs");
  });

  test("[V2 Voice] no speech recognition → explains and offers Switch to Chat", async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as Record<string, unknown>;
      delete w.SpeechRecognition; delete w.webkitSpeechRecognition;
      Object.defineProperty(window, "webkitSpeechRecognition", { value: undefined });
    });
    await openChat(page);
    await page.getByRole("tab", { name: "Voice" }).click();
    await expect(page.getByTestId("voice-unsupported")).toContainText("isn't supported");
    await page.getByRole("button", { name: "Switch to Chat" }).click();
    await expect(page.getByRole("tab", { name: "Chat" })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#chat-input")).toBeVisible();
  });
});

test.describe("[V2 A11y] conversation tab", () => {
  test("[V2 A11y] no serious axe violations in Chat", async ({ page }) => {
    await openChat(page);
    const r = await new AxeBuilder({ page }).include("#panel-conversation").analyze();
    expect(r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
  });
});
