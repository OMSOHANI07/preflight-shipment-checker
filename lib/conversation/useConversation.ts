"use client";

/**
 * One conversation shared by the Chat and Voice tabs. It lives only in this page: nothing is kept in
 * the browser or the database, so a refresh or a new visit always starts a fresh chat.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { BookingResult } from "@/lib/calculations";
import { OPENING } from "./engine";
import { createState } from "./state";
import type { ConversationState, Mode, TurnDiff, TurnResponse } from "./types";

/** Where older versions kept chats in the browser — wiped on load. */
const OLD_KEYS = ["pf-conversation-v2"];

function fresh(mode: Mode = "chat"): ConversationState {
  const s = createState();
  s.mode = mode;
  s.history.push({ role: "assistant", text: OPENING[mode], at: new Date().toISOString(), quickReplies: [] });
  return s;
}

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
  const flashTimer = useRef<number | null>(null);
  const commit = useCallback((s: ConversationState) => { stateRef.current = s; setState(s); }, []);

  // created after mount (ids and times differ between server and browser)
  useEffect(() => {
    let alive = true;
    try { OLD_KEYS.forEach((k) => localStorage.removeItem(k)); } catch { /* storage blocked */ }
    void Promise.resolve().then(() => { if (alive) commit(fresh()); });
    return () => { alive = false; };
  }, [commit]);

  const apply = useCallback((res: TurnResponse) => {
    commit(res.state);
    setLastDiff(res.diff);
    setLastSpeak(res.speak);
    const fields = new Set((res.diff?.fields ?? []).map((f) => f.field.split(":").pop()!.trim()));
    // one highlight at a time: a newer change cancels the older one's fade-out
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    setChanged(fields);
    flashTimer.current = fields.size ? window.setTimeout(() => setChanged(new Set()), 3000) : null;
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
  }, [apply]);

  const startOver = useCallback(async () => {
    const cur = stateRef.current;
    const s = fresh(cur?.mode ?? "chat");
    if (cur) { s.id = cur.id; s.version = cur.version + 1; }
    commit(s); setLastDiff(null);
  }, [commit]);

  const lastAssistant = state ? [...state.history].reverse().find((t) => t.role === "assistant") : undefined;
  return {
    state, result: state?.lastResult ?? null, busy, error, lastDiff, lastSpeak, changedFields,
    quickReplies: busy ? [] : lastAssistant?.quickReplies ?? [],
    send, startOver, canUndo: !!state?.undoStack.length, clearDiff: () => setLastDiff(null),
  };
}
