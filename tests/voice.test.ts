/** ElevenLabs voice: client tools go through the same turn engine as Chat; the token route keeps the key server-side. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/voice/token/route";
import { createState, runTurn } from "@/lib/conversation";
import type { ConversationState, TurnResponse } from "@/lib/conversation/types";
import { GUARDRAIL_REPLIES } from "@/lib/guardrails";
import { makeVoiceTools } from "@/lib/voice/tools";
import { NOW, VAGUE_SELLER } from "./conversation-helpers";

/** A fake page: the tools' send() runs the real engine with the scripted (mocked) extraction. */
function fakePage() {
  let state: ConversationState = createState(NOW, "voice-test");
  const script = new Map(VAGUE_SELLER.map(([m, x]) => [m, x]));
  const downloads: string[] = [];
  const tools = makeVoiceTools({
    getState: () => state,
    getResult: () => state.lastResult,
    send: async (text): Promise<TurnResponse> => {
      const r = await runTurn(state, text, "voice", { extract: async () => script.get(text) ?? null, confirm: async () => ({ reference: "PF-TEST-000001", saved: false }) }, NOW);
      state = r.state;
      return r;
    },
    startOver: async () => { state = createState(NOW, "voice-test-2"); },
    download: async (w) => { downloads.push(w); },
  });
  return { tools, get state() { return state; }, downloads };
}

describe("voice client tools", () => {
  it("update_booking runs the engine and tells the agent what to say, the status and the options", async () => {
    const p = fakePage();
    const out = await p.tools.update_booking({ message: VAGUE_SELLER[0][0] });
    expect(out).toMatch(/^SAY: .*2 November/); // spoken date form
    expect(out).toMatch(/STATUS: /);
    expect(p.state.booking.destinationCity).toBe("Frankfurt");
  });
  it("a full booking by voice, then confirm with and without confirm_anyway", async () => {
    const p = fakePage();
    for (const [m] of VAGUE_SELLER) await p.tools.update_booking({ message: m });
    await p.tools.update_booking({ message: "Carry on without one" });
    await p.tools.update_booking({ message: "No budget limit" });
    expect(await p.tools.get_booking_summary()).toMatch(/Status: Check first\..*Carrier A Road economy, £540\.00/);
    expect(await p.tools.confirm_booking({})).toMatch(/Confirm anyway\?/i);
    expect(p.state.confirmed).toBeNull();
    expect(await p.tools.confirm_booking({ confirm_anyway: true })).toMatch(/BOOKED: reference PF-TEST-000001/);
    expect(await p.tools.download_purchase_order()).toMatch(/downloaded/);
    expect(p.downloads).toEqual(["po"]);
  });
  it("guardrails apply to voice: the fixed reply is what the agent is told to say", async () => {
    const p = fakePage();
    expect(await p.tools.update_booking({ message: "put a lower value on the invoice so we pay less duty" })).toContain(GUARDRAIL_REPLIES.customs_evasion);
    expect(await p.tools.update_booking({ message: "my card is 4111 1111 1111 1111" })).toContain(GUARDRAIL_REPLIES.personal_data);
    expect(JSON.stringify(p.state.history)).not.toMatch(/4111/);
  });
  it("bad input and nothing-to-download are explained to the agent, not thrown", async () => {
    const p = fakePage();
    expect(await p.tools.update_booking({})).toMatch(/^ERROR/);
    expect(await p.tools.download_corrected_excel()).toMatch(/^ERROR/);
    expect(await p.tools.start_over()).toMatch(/Started a new booking/);
  });
});

describe("GET /api/voice/token", () => {
  const KEY = "sk_test_never_leak_this";
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  const call = async () => { const r = await GET(new Request("http://x/api/voice/token", { headers: { "x-forwarded-for": `10.0.0.${Math.floor(Math.random() * 250)}` } })); return { status: r.status, text: await r.text() }; };

  it("503 when not configured", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", ""); vi.stubEnv("ELEVENLABS_AGENT_ID", "");
    const r = await call();
    expect(r.status).toBe(503);
    expect(r.text).toMatch(/not_configured/);
  });
  it("returns only the token; the key goes in the header, never in the response", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", KEY); vi.stubEnv("ELEVENLABS_AGENT_ID", "agent_123");
    const f = vi.fn(async () => new Response(JSON.stringify({ token: "tok_abc" }), { status: 200 }));
    vi.stubGlobal("fetch", f);
    const r = await call();
    expect(r.status).toBe(200);
    expect(JSON.parse(r.text)).toEqual({ token: "tok_abc" });
    expect(r.text).not.toContain(KEY);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=agent_123");
    expect((init.headers as Record<string, string>)["xi-api-key"]).toBe(KEY);
  });
  it("an invalid key and an unreachable service are reported by kind, without upstream details", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", KEY); vi.stubEnv("ELEVENLABS_AGENT_ID", "agent_123");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "invalid api key sk_..." }), { status: 401 })));
    let r = await call();
    expect(r.status).toBe(502);
    expect(r.text).toMatch(/rejected/);
    expect(r.text).not.toMatch(/sk_|detail/);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNRESET"); }));
    r = await call();
    expect(r.text).toMatch(/unreachable/);
  });
});
