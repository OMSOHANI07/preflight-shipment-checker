"use client";

/**
 * Voice: an ElevenLabs Conversational AI agent (WebRTC). The browser gets a short-lived conversation
 * token from /api/voice/token (the API key never leaves the server). The agent talks; every booking
 * change goes through client tools into the same turn engine as Chat, so the rules, guardrails and maths
 * are identical — and the summary panel and booking card update live.
 */
import { ConversationProvider, useConversation as useVoiceAgent } from "@elevenlabs/react";
import { useReducedMotion } from "framer-motion";
import { Keyboard, Loader2, Mic, MicOff, PhoneOff, Volume2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConversationApi } from "@/lib/conversation/useConversation";
import type { Turn } from "@/lib/conversation/types";
import { cx } from "@/lib/ui";
import { makeVoiceTools } from "@/lib/voice/tools";
import { MessageList, QuickReplies, UndoStartOver } from "./ChatTab";
import { DiffToast } from "./DiffToast";
import { DOWNLOAD_CHIPS, ReviewCard, runDownload } from "./ReviewCard";

type Problem = { kind: "denied" | "no_mic" | "config" | "network" | "error"; text: string } | null;

export function VoiceTab({ api, onSwitchToChat }: { api: ConversationApi; onSwitchToChat: () => void }) {
  return (
    <ConversationProvider>
      <VoiceAgent api={api} onSwitchToChat={onSwitchToChat} />
    </ConversationProvider>
  );
}

function VoiceAgent({ api, onSwitchToChat }: { api: ConversationApi; onSwitchToChat: () => void }) {
  const reduce = useReducedMotion();
  const [problem, setProblem] = useState<Problem>(null);
  const [transcript, setTranscript] = useState<Turn[]>([]);
  const [typed, setTyped] = useState("");
  const [starting, setStarting] = useState(false);
  const [level, setLevel] = useState(0);
  const [supported] = useState(() => typeof navigator === "undefined" || !!navigator.mediaDevices?.getUserMedia);
  const s = api.state!;

  // the tools always see the latest conversation (they're called from the agent's event loop)
  const apiRef = useRef(api);
  useEffect(() => { apiRef.current = api; }, [api]);
  // eslint-disable-next-line react-hooks/refs -- the ref is read when the agent calls a tool, never during render
  const tools = useMemo(() => makeVoiceTools({
    getState: () => apiRef.current.state,
    getResult: () => apiRef.current.result,
    send: (text) => apiRef.current.send(text, "voice"),
    startOver: () => apiRef.current.startOver(),
    download: async (which) => {
      const a = apiRef.current;
      if (a.state && a.result) await runDownload(which === "po" ? DOWNLOAD_CHIPS[0] : DOWNLOAD_CHIPS[1], a.state, a.result);
    },
  }), []);

  const voice = useVoiceAgent({
    clientTools: tools,
    onConnect: () => setProblem(null),
    onMessage: ({ message, role }) => {
      if (!message?.trim()) return;
      setTranscript((t) => [...t, { role: role === "user" ? "seller" as const : "assistant" as const, text: message, at: new Date().toISOString() }].slice(-200));
    },
    onError: () => setProblem({ kind: "error", text: "Something went wrong with the voice connection — tap the mic to try again, or type instead." }),
    onDisconnect: (d) => {
      if (d.reason === "error") setProblem({ kind: "network", text: "The voice connection dropped — tap the mic to reconnect. Your booking is still here." });
    },
  });
  const connected = voice.status === "connected";
  const connecting = voice.status === "connecting" || starting;

  // mic / agent level ring (decorative)
  useEffect(() => {
    if (!connected || reduce) return;
    let raf = 0;
    const tick = () => { setLevel(Math.min(1, (voice.isSpeaking ? voice.getOutputVolume() : voice.getInputVolume()) * 1.6)); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); setLevel(0); };
  }, [connected, reduce, voice]);

  // a network drop while talking
  useEffect(() => {
    const off = () => { if (connected) setProblem({ kind: "network", text: "You're offline — the call will stop. Tap the mic when you're back online." }); };
    window.addEventListener("offline", off);
    return () => window.removeEventListener("offline", off);
  }, [connected]);

  // leaving the Voice tab ends the call
  const endRef = useRef(voice.endSession);
  useEffect(() => { endRef.current = voice.endSession; }, [voice.endSession]);
  useEffect(() => () => { try { endRef.current(); } catch { /* not connected */ } }, []);

  const start = useCallback(async () => {
    setProblem(null);
    setStarting(true);
    try {
      // ask for the mic first so a refusal is explained clearly
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
      } catch (e) {
        const name = (e as { name?: string })?.name;
        setProblem(name === "NotFoundError" || name === "OverconstrainedError"
          ? { kind: "no_mic", text: "No microphone was found. Plug one in and try again, or type instead." }
          : { kind: "denied", text: "The microphone is blocked." });
        return;
      }
      const res = await fetch("/api/voice/token", { cache: "no-store" }).catch(() => null);
      const body = (await res?.json().catch(() => null)) as { token?: string; error?: string; kind?: string } | null;
      if (!res || !res.ok || !body?.token) {
        setProblem({ kind: body?.kind === "not_configured" || body?.kind === "rejected" || body?.kind === "agent_missing" ? "config" : "network", text: body?.error ?? "Couldn't reach the voice service — check your connection and try again." });
        return;
      }
      voice.startSession({ conversationToken: body.token, connectionType: "webrtc" });
    } finally {
      setStarting(false);
    }
  }, [voice]);

  const toggle = () => {
    if (connected) voice.endSession();
    else if (!connecting) void start();
  };

  const sendTyped = async (text: string) => {
    if (connected) {
      voice.sendUserMessage(text);
      setTranscript((t) => [...t, { role: "seller" as const, text, at: new Date().toISOString() }]);
    } else await api.send(text, "voice");
  };

  const review = !!api.result && (s.confirmed || ["review", "blocked", "amber", "done"].includes(s.pending?.kind ?? ""));
  const label = connecting ? "Connecting…" : !connected ? (transcript.length ? "Call ended — tap to talk again" : "Tap to talk") : voice.isSpeaking ? "Agent speaking… tap to end" : "Listening… tap to end";

  if (!supported || problem?.kind === "denied") {
    return (
      <div className="card p-8 text-center sm:p-12" data-testid="voice-unsupported">
        <MicOff size={40} className="mx-auto text-muted" aria-hidden />
        <h3 className="mt-4 text-[22px] font-semibold">{supported ? "The microphone is blocked" : "Voice isn't supported in this browser"}</h3>
        <p className="mx-auto mt-2 max-w-[460px] text-[15px] text-muted">
          {supported
            ? "Allow microphone access for this site (click the lock or camera icon in the address bar → Microphone → Allow), then try again. Or use Chat — it's the same booking."
            : "Voice needs a browser with microphone access. Use Chat instead — it's the same conversation and booking."}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          {supported && <button type="button" className="btn btn-ghost" onClick={() => { setProblem(null); void start(); }}>Try again</button>}
          <button type="button" className="btn btn-primary" onClick={onSwitchToChat}>Switch to Chat</button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="card p-6 text-center sm:p-10">
        <div className="relative mx-auto flex size-40 items-center justify-center">
          <span aria-hidden className="absolute inset-0 rounded-full transition-transform duration-75" style={{ background: "var(--blue-tint)", transform: `scale(${connected ? 0.85 + level * 0.35 : 0.85})` }} />
          {connecting && !reduce && <span aria-hidden className="absolute inset-3 animate-ping rounded-full" style={{ background: "var(--blue-tint)" }} />}
          <button type="button" onClick={toggle} data-testid="mic" disabled={connecting}
            aria-label={label} aria-pressed={connected}
            className={cx("relative flex size-28 items-center justify-center rounded-full text-white shadow-[var(--shadow-lg)] transition-transform hover:scale-105 disabled:opacity-80",
              connected ? "bg-[var(--red)]" : "bg-accent-fill")}>
            {connecting ? <Loader2 size={40} className="animate-spin motion-reduce:animate-none" /> : connected ? (voice.isSpeaking ? <Volume2 size={40} /> : <PhoneOff size={36} />) : <Mic size={40} />}
          </button>
        </div>
        <p className="mt-4 text-[15px] font-medium" aria-live="polite" data-testid="voice-status">{label}</p>
        {problem && <p role="alert" className="mx-auto mt-2 max-w-[520px] text-[14px] text-[var(--red-text)]" data-testid="voice-problem">{problem.text}</p>}
        {problem?.kind === "config" && <button type="button" className="btn btn-primary btn-sm mt-3" onClick={onSwitchToChat}>Switch to Chat</button>}
        <p className="mx-auto mt-4 max-w-[480px] text-[12px] text-muted">Privacy: your voice is streamed to ElevenLabs to run the call. Don&apos;t share card, bank or passport details.</p>
      </div>

      <div className="card p-4 sm:p-6">
        <MessageList history={transcript.length ? transcript : s.history.slice(0, 1)} busy={api.busy} />
        <div className="mt-4 space-y-3">
          {!connected && <QuickReplies options={api.quickReplies} onPick={(t) => ((DOWNLOAD_CHIPS as readonly string[]).includes(t) && api.result ? void runDownload(t, s, api.result) : void sendTyped(t))} disabled={api.busy || connecting} />}
          <DiffToast diff={api.lastDiff} onClose={api.clearDiff} />
          {api.error && <p role="alert" className="text-[13px] text-[var(--red-text)]">{api.error}</p>}
          <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); const t = typed.trim(); if (t) { setTyped(""); void sendTyped(t); } }}>
            <label htmlFor="voice-type" className="flex items-center gap-1.5 self-center text-[13px] text-muted"><Keyboard size={15} aria-hidden /> Type instead</label>
            <input id="voice-type" value={typed} maxLength={1000}
              onChange={(e) => { setTyped(e.target.value); if (connected) voice.sendUserActivity(); }}
              placeholder={connected ? "Type to the agent…" : "Type your answer…"} className="h-11 flex-1 rounded-full border hairline bg-surface px-4 text-[15px] outline-none focus:border-[var(--accent)]" />
            <button type="submit" className="btn btn-primary btn-sm" disabled={!typed.trim() || api.busy}>Send</button>
          </form>
          <UndoStartOver api={api} />
        </div>
      </div>
      {review && api.result && (
        <ReviewCard state={s} result={api.result} onConfirm={async (ack) => {
          const r = await api.send(api.result?.status === "AMBER" && ack ? "Confirm anyway" : "confirm", "voice");
          if (r && !r.state.confirmed && r.state.pendingConfirm?.kind === "amber") return (await api.send("Confirm anyway", "voice"))?.state.confirmed?.reference ?? null;
          return r?.state.confirmed?.reference ?? null;
        }} />
      )}
    </div>
  );
}
