"use client";

/**
 * Voice (prompt §5): push-to-talk speech-to-text (Web Speech API, en-GB) → the same /api/chat turn
 * as Chat (mode "voice": one question per turn, read-backs) → the reply spoken with an en-GB voice.
 * Never listens while speaking. Recognition and speech start only inside a user gesture.
 */
import { useReducedMotion } from "framer-motion";
import { Keyboard, Loader2, Mic, MicOff, Volume2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ConversationApi } from "@/lib/conversation/useConversation";
import { cx } from "@/lib/ui";
import { MessageList, QuickReplies, UndoStartOver } from "./ChatTab";
import { DiffToast } from "./DiffToast";
import { DOWNLOAD_CHIPS, ReviewCard, runDownload } from "./ReviewCard";

type Phase = "idle" | "listening" | "review" | "thinking" | "speaking";

interface SR {
  lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number;
  start: () => void; stop: () => void; abort: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string; confidence: number }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type SRCtor = new () => SR;
const getSR = (): SRCtor | null => {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

/** Pick an en-GB voice once the list has loaded (Chrome fills it asynchronously — G9). */
function useBritishVoice() {
  const [voice, setVoice] = useState<SpeechSynthesisVoice | null>(null);
  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const pick = () => {
      const vs = window.speechSynthesis.getVoices();
      setVoice(vs.find((v) => v.lang === "en-GB" && /female|google uk english female|serena|kate/i.test(v.name)) ?? vs.find((v) => v.lang === "en-GB") ?? vs.find((v) => v.lang.startsWith("en")) ?? null);
    };
    pick();
    window.speechSynthesis.addEventListener("voiceschanged", pick);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", pick);
  }, []);
  return voice;
}

export function VoiceTab({ api, onSwitchToChat }: { api: ConversationApi; onSwitchToChat: () => void }) {
  const reduce = useReducedMotion();
  const voice = useBritishVoice();
  const [supported] = useState(() => getSR() !== null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [interim, setInterim] = useState("");
  const [finalText, setFinalText] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [typed, setTyped] = useState("");
  const [level, setLevel] = useState(0);
  const rec = useRef<SR | null>(null);
  const audio = useRef<{ ctx: AudioContext; stream: MediaStream; raf: number } | null>(null);
  const sendTimer = useRef<number | null>(null);
  const s = api.state!;

  const stopLevel = useCallback(() => {
    if (!audio.current) return;
    cancelAnimationFrame(audio.current.raf);
    audio.current.stream.getTracks().forEach((t) => t.stop());
    void audio.current.ctx.close();
    audio.current = null;
    setLevel(0);
  }, []);

  /** Animated ring from the mic level (AnalyserNode). Optional: recognition works without it. */
  const startLevel = useCallback(async () => {
    if (reduce || !navigator.mediaDevices?.getUserMedia) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new AudioContext();
      const an = ctx.createAnalyser(); an.fftSize = 256;
      ctx.createMediaStreamSource(stream).connect(an);
      const buf = new Uint8Array(an.frequencyBinCount);
      const tick = () => { an.getByteTimeDomainData(buf); let m = 0; for (const v of buf) m = Math.max(m, Math.abs(v - 128)); setLevel(Math.min(1, m / 64)); audio.current!.raf = requestAnimationFrame(tick); };
      audio.current = { ctx, stream, raf: requestAnimationFrame(tick) };
    } catch { /* the recogniser reports permission problems */ }
  }, [reduce]);

  const speak = useCallback((text: string) => {
    if (!("speechSynthesis" in window) || !text) { setPhase("idle"); return; }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-GB"; if (voice) u.voice = voice; u.rate = 1.02;
    // some browsers never fire onend (no voices installed) — don't leave the mic stuck on "Speaking"
    const guard = window.setTimeout(() => setPhase((p) => (p === "speaking" ? "idle" : p)), 2000 + text.length * 90);
    u.onend = u.onerror = () => { window.clearTimeout(guard); setPhase("idle"); };
    setPhase("speaking");
    window.speechSynthesis.speak(u);
  }, [voice]);

  const sendVoice = useCallback(async (text: string) => {
    setPhase("thinking"); setFinalText(""); setInterim("");
    const r = await api.send(text, "voice");
    if (r) speak(r.speak); else setPhase("idle");
  }, [api, speak]);

  const listen = useCallback(() => {
    // tapping while speaking stops the speech immediately (and we never listen while speaking — G3)
    if (phase === "speaking") { window.speechSynthesis.cancel(); setPhase("idle"); return; }
    if (phase === "listening") { rec.current?.stop(); return; }
    if (phase === "thinking") return;
    const Ctor = getSR();
    if (!Ctor) return;
    setProblem(null); setInterim(""); setFinalText("");
    const r = new Ctor();
    r.lang = "en-GB"; r.interimResults = true; r.continuous = false; r.maxAlternatives = 1;
    let got = "";
    r.onresult = (e) => {
      let fin = "", mid = "";
      for (let i = e.resultIndex; i < e.results.length; i++) { const res = e.results[i]; if (res.isFinal) fin += res[0].transcript; else mid += res[0].transcript; }
      if (mid) setInterim(mid);
      if (fin) got = (got + " " + fin).trim();
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") setDenied(true);
      else if (e.error === "no-speech" || e.error === "aborted") setProblem("I didn't catch that — tap the mic to try again.");
      else setProblem("Something went wrong with the microphone — tap to try again, or type instead.");
    };
    r.onend = () => {
      stopLevel();
      if (!got) { setPhase("idle"); return; }
      // show the transcript for 1.5 s with an Edit option, then send (G8)
      setFinalText(got); setInterim(""); setPhase("review");
      sendTimer.current = window.setTimeout(() => { sendTimer.current = null; void sendVoice(got); }, 1500);
    };
    rec.current = r;
    window.speechSynthesis?.cancel();
    setPhase("listening");
    try { r.start(); void startLevel(); } catch { setPhase("idle"); setProblem("Couldn't start the microphone — tap to try again."); }
  }, [phase, sendVoice, startLevel, stopLevel]);

  const edit = () => {
    if (sendTimer.current) { window.clearTimeout(sendTimer.current); sendTimer.current = null; }
    setTyped(finalText); setFinalText(""); setPhase("idle");
  };

  useEffect(() => () => { rec.current?.abort(); stopLevel(); if (typeof window !== "undefined") window.speechSynthesis?.cancel(); if (sendTimer.current) window.clearTimeout(sendTimer.current); }, [stopLevel]);

  const review = !!api.result && (s.confirmed || ["review", "blocked", "amber", "done"].includes(s.pending?.kind ?? ""));
  const label = { idle: "Tap to talk", listening: "Listening… tap to stop", review: "Got it", thinking: "Thinking…", speaking: "Speaking… tap to interrupt" }[phase];

  if (!supported || denied) {
    return (
      <div className="card p-8 text-center sm:p-12" data-testid="voice-unsupported">
        <MicOff size={40} className="mx-auto text-muted" aria-hidden />
        <h3 className="mt-4 text-[22px] font-semibold">{denied ? "The microphone is blocked" : "Voice isn't supported in this browser"}</h3>
        <p className="mx-auto mt-2 max-w-[460px] text-[15px] text-muted">
          {denied
            ? "Allow microphone access for this site (click the lock or camera icon in the address bar → Microphone → Allow), then reload. Or use Chat — it's the same booking."
            : "Speech recognition works in Chrome, Edge and Safari. In this browser, use Chat instead — it's the same conversation and booking."}
        </p>
        <button type="button" className="btn btn-primary mt-6" onClick={onSwitchToChat}>Switch to Chat</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="card p-6 text-center sm:p-10">
        <div className="relative mx-auto flex size-40 items-center justify-center">
          <span aria-hidden className="absolute inset-0 rounded-full transition-transform duration-75" style={{ background: "var(--blue-tint)", transform: `scale(${phase === "listening" ? 0.85 + level * 0.35 : 0.85})` }} />
          {phase === "speaking" && !reduce && <span aria-hidden className="absolute inset-3 animate-ping rounded-full" style={{ background: "var(--blue-tint)" }} />}
          <button type="button" onClick={listen} data-testid="mic"
            aria-label={label} aria-pressed={phase === "listening"}
            className={cx("relative flex size-28 items-center justify-center rounded-full text-white shadow-[var(--shadow-lg)] transition-transform hover:scale-105",
              phase === "listening" ? "bg-[var(--red)]" : "bg-accent-fill")}>
            {phase === "thinking" ? <Loader2 size={40} className="animate-spin motion-reduce:animate-none" /> : phase === "speaking" ? <Volume2 size={40} /> : <Mic size={40} />}
          </button>
        </div>
        <p className="mt-4 text-[15px] font-medium" aria-live="polite">{label}</p>
        <p className="mx-auto mt-2 min-h-6 max-w-[520px] text-[17px]" aria-live="polite" data-testid="transcript">
          {phase === "listening" && <span className="text-muted">{interim || "…"}</span>}
          {phase === "review" && finalText && (
            <>“{finalText}” <button type="button" onClick={edit} className="ml-2 text-[14px] text-accent-text underline">Edit</button></>
          )}
        </p>
        {problem && <p role="alert" className="mt-2 text-[14px] text-[var(--red-text)]">{problem}</p>}
        <p className="mx-auto mt-4 max-w-[460px] text-[12px] text-muted">Privacy: in Chrome, speech recognition sends your audio to Google to turn it into text.</p>
      </div>

      <div className="card p-4 sm:p-6">
        <MessageList history={s.history} busy={api.busy && phase !== "thinking"} />
        <div className="mt-4 space-y-3">
          <QuickReplies options={api.quickReplies} onPick={(t) => ((DOWNLOAD_CHIPS as readonly string[]).includes(t) && api.result ? void runDownload(t, s, api.result).catch(() => setProblem("That download didn't work — please try again.")) : void sendVoice(t))} disabled={api.busy || phase === "listening"} />
          <DiffToast diff={api.lastDiff} onClose={api.clearDiff} />
          {api.error && <p role="alert" className="text-[13px] text-[var(--red-text)]">{api.error}</p>}
          <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); const t = typed.trim(); if (t) { setTyped(""); void sendVoice(t); } }}>
            <label htmlFor="voice-type" className="flex items-center gap-1.5 self-center text-[13px] text-muted"><Keyboard size={15} aria-hidden /> Type instead</label>
            <input id="voice-type" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type your answer…" className="h-11 flex-1 rounded-full border hairline bg-surface px-4 text-[15px] outline-none focus:border-[var(--accent)]" />
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
