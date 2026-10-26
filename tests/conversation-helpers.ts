/** Test helpers: drive runTurn() with a mocked Gemini that returns a fixed extraction per turn. */
import { createState, runTurn, type TurnDeps } from "@/lib/conversation";
import { DEMO_SCRIPT } from "@/lib/conversation/demo";
import { ExtractionSchema, type ConversationState, type Extraction, type Mode, type TurnResponse } from "@/lib/conversation/types";

export const NOW = new Date("2026-10-26T10:00:00Z"); // Monday 26-10-2026 (UK)
export const ex = (x: Record<string, unknown>): Extraction => ExtractionSchema.parse(x);

/** A scripted turn: what the seller types and what "Gemini" extracts from it (null → no AI, use the fallback). */
export type Script = [message: string, extraction: Extraction | null][];

export async function play(script: Script, opts: { mode?: Mode; state?: ConversationState; deps?: Partial<TurnDeps> } = {}) {
  let state = opts.state ?? createState(NOW, "test-conv");
  const turns: TurnResponse[] = [];
  for (const [message, extraction] of script) {
    const r = await runTurn(state, message, opts.mode ?? "chat", {
      extract: async () => extraction,
      confirm: async () => ({ reference: "PF-TEST-000001", saved: false }),
      ...opts.deps,
    }, NOW);
    turns.push(r);
    state = r.state;
  }
  return { state, turns, last: turns[turns.length - 1] };
}

/** QUESTIONS.md §7.1 — the vague seller, as Gemini would extract each message (shared with GEMINI_MOCK). */
export const VAGUE_SELLER: Script = DEMO_SCRIPT.map(([m, x]) => [m, ex(x)]);
