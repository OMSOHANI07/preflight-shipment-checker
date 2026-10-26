"use client";

/**
 * One conversation shared by the Chat and Voice tabs. Restores on load (browser copy → Neon → new),
 * saves to localStorage after every turn (Neon is saved by /api/chat), and handles the two-tab case.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { BookingResult } from "@/lib/calculations";
import { OPENING } from "./engine";
import { createState } from "./state";
import type { ConversationState, Mode, TurnDiff, TurnResponse } from "./types";

const KEY = "pf-conversation-v2";

function fresh(mode: Mode = "chat"): ConversationState {
  const s = createState();
  s.mode = mode;
  s.history.push({ role: "assistant", text: OPENING[mode], at: new Date().toISOString(), quickReplies: [] });
  return s;
}
const readLocal = (): ConversationState | null => { try { const t = localStorage.getItem(KEY); return t ? (JSON.parse(t) as ConversationState) : null; } catch { return null; } };
const writeLocal = (s: ConversationState) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode etc. */ } };

export interface ConversationApi {
  state: ConversationState | null;
  result: BookingResult | null;
  busy: boolean;
  error: string | null;
  lastDiff: TurnDiff | null;
  lastSpeak: string | null;
  quickReplies: string[];
  changedFields: Set<string>;
  send: (text: string, mode: Mode) => Promise<TurnResponse | null>;
  startOver: () => Promise<void>;
  canUndo: boolean;
  clearDiff: () => void;
}

export function useConversation(): ConversationApi {
  const [state, setState] = useState<ConversationState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastDiff, setLastDiff] = useState<TurnDiff | null>(null);
  const [lastSpeak, setLastSpeak] = useState<string | null>(null);
  const [changedFields, setChanged] = useState<Set<string>>(new Set());
  // the last state the server agreed to (the optimistic seller bubble is display-only)
  const stateRef = useRef<ConversationState | null>(null);
  const commit = useCallback((s: ConversationState) => { stateRef.current = s; setState(s); }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const local = readLocal();
      let s = local;
      try {
        const r = await fetch("/api/conversation", { cache: "no-store" });
        const j = (await r.json()) as { state: ConversationState | null };
        if (j.state && (!s || (j.state.id === s.id && j.state.version > s.version))) s = j.state;
      } catch { /* offline / no DB — the browser copy is enough */ }
      if (alive) commit(s ?? fresh());
    })();
    return () => { alive = false; };
  }, [commit]);

  const apply = useCallback((res: TurnResponse) => {
    commit(res.state);
    writeLocal(res.state);
    setLastDiff(res.diff);
    setLastSpeak(res.speak);
    const fields = new Set((res.diff?.fields ?? []).map((f) => f.field.split(":").pop()!.trim()));
    setChanged(fields);
    if (fields.size) window.setTimeout(() => setChanged(new Set()), 2000);
  }, [commit]);

  const send = useCallback(async (text: string, mode: Mode) => {
    const cur = stateRef.current;
    if (!cur) return null;
    setBusy(true);
    setError(null);
    // show the seller's message straight away
    setState({ ...cur, history: [...cur.history, { role: "seller", text, at: new Date().toISOString() }] });
    try {
      const r = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: text, state: cur, mode }) });
      const j = await r.json();
      if (r.status === 409 && j.state) { commit(j.state); writeLocal(j.state); setError(j.error); return null; }
      if (!r.ok) { setState(cur); setError(j.error ?? "Something went wrong — please try again."); return null; }
      apply(j as TurnResponse);
      return j as TurnResponse;
    } catch {
      setState(cur);
      setError("Couldn't reach the server — check your connection and try again.");
      return null;
    } finally {
      setBusy(false);
    }
  }, [apply, commit]);

  const startOver = useCallback(async () => {
    const cur = stateRef.current;
    const s = fresh(cur?.mode ?? "chat");
    if (cur) { s.id = cur.id; s.version = cur.version + 1; }
    commit(s); writeLocal(s); setLastDiff(null);
    fetch("/api/conversation", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state: s }) }).catch(() => undefined);
  }, [commit]);

  const lastAssistant = state ? [...state.history].reverse().find((t) => t.role === "assistant") : undefined;
  return {
    state, result: state?.lastResult ?? null, busy, error, lastDiff, lastSpeak, changedFields,
    quickReplies: busy ? [] : lastAssistant?.quickReplies ?? [],
    send, startOver, canUndo: !!state?.undoStack.length, clearDiff: () => setLastDiff(null),
  };
}
