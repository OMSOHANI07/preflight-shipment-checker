/**
 * GET  /api/conversation — the latest conversation for this browser's session cookie (refresh / new tab).
 * PUT  /api/conversation — save a browser copy (e.g. after Undo/Start over done locally). Version-checked.
 */
import { cookies } from "next/headers";
import { z } from "zod";
import { loadConversation, saveConversation, SESSION_COOKIE } from "@/lib/conversation/store";
import type { ConversationState } from "@/lib/conversation/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const sid = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!sid) return Response.json({ state: null });
  return Response.json({ state: await loadConversation(sid) });
}

const Body = z.object({ state: z.custom<ConversationState>((v) => !!v && typeof v === "object" && typeof (v as ConversationState).id === "string" && typeof (v as ConversationState).version === "number") });

export async function PUT(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const jar = await cookies();
  let sid = jar.get(SESSION_COOKIE)?.value;
  if (!sid) { sid = crypto.randomUUID(); jar.set(SESSION_COOKIE, sid, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30 }); }
  const server = await loadConversation(sid, parsed.data.state.id);
  if (server && server.version > parsed.data.state.version) return Response.json({ error: "A newer version exists", state: server }, { status: 409 });
  return Response.json({ saved: await saveConversation(sid, parsed.data.state) });
}
