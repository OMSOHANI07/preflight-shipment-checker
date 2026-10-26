/**
 * POST /api/chat — one conversation turn (prompt §3.2): { message, state, mode } →
 * { state, reply, speak, quickReplies, result, diff }. Gemini extracts and phrases; calculations.ts
 * decides everything. Works with GEMINI_API_KEY unset (regex fallback + fixed wording) and with Neon down.
 * Conversations are not stored: the page holds the state and sends it with each message.
 */
import { z } from "zod";
import { createConfirmation } from "@/lib/confirm";
import { createState, runTurn, type TurnDeps } from "@/lib/conversation";
import type { ConversationState } from "@/lib/conversation/types";
import { geminiExtract } from "@/lib/gemini/extract";
import { countFlags, type ScreenFlag } from "@/lib/guardrails";
import { geminiMockEnabled, mockExtract } from "@/lib/gemini/mock";
import { geminiR06, geminiReply } from "@/lib/gemini/reply";
import { clientIp, rateLimited } from "@/lib/rateLimit";

export const maxDuration = 30;

/**
 * The page sends the conversation back each turn, so treat it as untrusted: right shape, sane sizes,
 * short strings. Results, status and confirmation are always recomputed here, never taken from it.
 */
const short = (v: unknown, max: number) => v == null || (typeof v === "string" && v.length <= max) || typeof v === "number" || typeof v === "boolean";
const StateShape = z.custom<ConversationState>((v) => {
  const s = v as ConversationState;
  if (!s || typeof s !== "object" || typeof s.id !== "string" || s.id.length > 80 || typeof s.version !== "number") return false;
  if (typeof s.booking !== "object" || s.booking === null || !Array.isArray(s.items) || !Array.isArray(s.history)) return false;
  if (s.items.length > 50 || s.history.length > 400 || (s.undoStack?.length ?? 0) > 60) return false;
  if (!Object.values(s.booking).every((x) => short(x, 300) || typeof x === "object")) return false;
  if (!s.items.every((it) => it && typeof it === "object" && Object.values(it).every((x) => short(x, 300) || typeof x === "object"))) return false;
  return s.history.every((t) => t && (t.role === "seller" || t.role === "assistant") && typeof t.text === "string" && t.text.length <= 4000);
});
const Body = z.object({ message: z.string().max(4_000), state: StateShape.nullable(), mode: z.enum(["chat", "voice"]).default("chat") });
const MAX_BODY = 600_000;

export async function POST(req: Request) {
  if (rateLimited(clientIp(req))) return Response.json({ error: "Too many messages — please wait a moment and try again." }, { status: 429 });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return Response.json({ error: "That conversation is too long — please start over." }, { status: 413 });
  const raw = await req.text().catch(() => "");
  if (raw.length > MAX_BODY) return Response.json({ error: "That conversation is too long — please start over." }, { status: 413 });
  let body: unknown = null;
  try { body = JSON.parse(raw); } catch { /* invalid */ }
  const parsed = Body.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });

  // never trust the page's copy of a result or a confirmation: drop them and recompute
  const state = parsed.data.state ? { ...parsed.data.state, lastResult: null } : createState();

  const mock = geminiMockEnabled();
  const deps: TurnDeps = {
    extract: mock ? async ({ message }) => mockExtract(message) : geminiExtract,
    reply: mock ? undefined : geminiReply,
    r06: mock ? async () => null : geminiR06,
    confirm: (c) => createConfirmation({ ...c, bookingRowId: null }),
    extractionSource: mock ? "mock" : "ai",
  };
  const res = await runTurn(state, parsed.data.message, parsed.data.mode, deps);
  countFlags((res.guardrailFlags ?? []) as ScreenFlag[]);
  return Response.json(res, { headers: { "Cache-Control": "no-store" } });
}
