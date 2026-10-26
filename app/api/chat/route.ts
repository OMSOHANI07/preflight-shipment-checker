/**
 * POST /api/chat — one conversation turn (prompt §3.2): { message, state, mode } →
 * { state, reply, speak, quickReplies, result, diff }. Gemini extracts and phrases; calculations.ts
 * decides everything. Works with GEMINI_API_KEY unset (regex fallback + fixed wording) and with Neon down.
 */
import { cookies } from "next/headers";
import { after } from "next/server";
import { z } from "zod";
import { createConfirmation } from "@/lib/confirm";
import { createState, runTurn, type TurnDeps } from "@/lib/conversation";
import { loadConversation, saveConversation, SESSION_COOKIE } from "@/lib/conversation/store";
import type { ConversationState } from "@/lib/conversation/types";
import { geminiExtract } from "@/lib/gemini/extract";
import { geminiMockEnabled, mockExtract } from "@/lib/gemini/mock";
import { geminiR06, geminiReply } from "@/lib/gemini/reply";
import { clientIp, rateLimited } from "@/lib/rateLimit";

export const maxDuration = 30;

const StateShape = z.custom<ConversationState>((v) => {
  const s = v as ConversationState;
  return !!s && typeof s === "object" && typeof s.id === "string" && typeof s.version === "number" && typeof s.booking === "object" && Array.isArray(s.items) && Array.isArray(s.history);
});
const Body = z.object({ message: z.string().max(20_000), state: StateShape.nullable(), mode: z.enum(["chat", "voice"]).default("chat") });

export async function POST(req: Request) {
  if (rateLimited(clientIp(req))) return Response.json({ error: "Too many messages — please wait a moment and try again." }, { status: 429 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });

  const jar = await cookies();
  let sessionId = jar.get(SESSION_COOKIE)?.value;
  if (!sessionId || !/^[0-9a-f-]{36}$/i.test(sessionId)) {
    sessionId = crypto.randomUUID();
    jar.set(SESSION_COOKIE, sessionId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30 });
  }

  const state = parsed.data.state ?? createState();
  // optimistic concurrency: a turn from a stale tab is rejected with the newer copy (F17)
  const server = await loadConversation(sessionId, state.id);
  if (server && server.version > state.version)
    return Response.json({ error: "This conversation changed in another tab — showing the latest version.", state: server }, { status: 409 });

  const mock = geminiMockEnabled();
  const deps: TurnDeps = {
    extract: mock ? async ({ message }) => mockExtract(message) : geminiExtract,
    reply: mock ? undefined : geminiReply,
    r06: mock ? async () => null : geminiR06,
    confirm: (c) => createConfirmation({ ...c, bookingRowId: null }),
    extractionSource: mock ? "mock" : "ai",
  };
  const res = await runTurn(state, parsed.data.message, parsed.data.mode, deps);
  const sid = sessionId;
  after(() => saveConversation(sid, res.state).then(() => undefined));
  return Response.json(res);
}
