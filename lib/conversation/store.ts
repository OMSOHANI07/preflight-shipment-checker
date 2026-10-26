/** Server-only: conversation persistence in Neon (best effort — the browser copy is the fallback). */
import "server-only";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { safe, schema } from "@/lib/db";
import type { ConversationState } from "./types";

export const SESSION_COOKIE = "pf_session";

export async function loadConversation(sessionId: string, id?: string): Promise<ConversationState | null> {
  const rows = await safe("load conversation", (d) =>
    d.select({ state: schema.conversations.state }).from(schema.conversations)
      .where(id ? and(eq(schema.conversations.sessionId, sessionId), eq(schema.conversations.id, id)) : eq(schema.conversations.sessionId, sessionId))
      .orderBy(desc(schema.conversations.updatedAt)).limit(1));
  return (rows?.[0]?.state as ConversationState | undefined) ?? null;
}

/** Upsert, but never replace a newer version (two tabs). Returns false if the DB is unavailable. */
export async function saveConversation(sessionId: string, state: ConversationState): Promise<boolean> {
  const done = await safe("save conversation", (d) =>
    d.insert(schema.conversations).values({ id: state.id, sessionId, version: state.version, state, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: schema.conversations.id,
        set: { state, version: state.version, updatedAt: new Date(), sessionId },
        setWhere: and(eq(schema.conversations.sessionId, sessionId), lt(schema.conversations.version, sql`${state.version}`)),
      }));
  return done !== null;
}
