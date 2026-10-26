"use client";

import { ArrowUp, RotateCcw, Undo2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ConversationApi } from "@/lib/conversation/useConversation";
import type { Turn } from "@/lib/conversation/types";
import { cx } from "@/lib/ui";
import { DiffToast } from "./DiffToast";
import { ReviewCard } from "./ReviewCard";

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

export function MessageList({ history, busy }: { history: Turn[]; busy: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  // keep the newest message in view inside the list (not by scrolling the whole page)
  useEffect(() => { const b = box.current; if (b) b.scrollTo({ top: b.scrollHeight, behavior: "smooth" }); }, [history.length, busy]);
  return (
    <div ref={box} role="log" aria-live="polite" aria-label="Conversation" tabIndex={0} className="-mx-2 max-h-[60vh] min-h-48 space-y-3 overflow-y-auto px-2 outline-none" data-testid="messages">
      {history.map((t, i) => (
        <div key={i} className={cx("flex", t.role === "seller" ? "justify-end" : "justify-start")}>
          {/* plain text only: links and HTML in messages are shown as text */}
          <p title={time(t.at)} className={cx("max-w-[85%] whitespace-pre-wrap break-words rounded-3xl px-4 py-2.5 text-[15px] leading-relaxed",
            t.role === "seller" ? "rounded-br-lg bg-accent-fill text-white" : "rounded-bl-lg bg-surface-2 text-fg")} data-role={t.role}>
            {t.text}
          </p>
        </div>
      ))}
      {busy && (
        <div className="flex justify-start" aria-label="Assistant is typing">
          <span className="flex gap-1 rounded-3xl rounded-bl-lg bg-surface-2 px-4 py-3.5">
            {[0, 1, 2].map((k) => <span key={k} className="size-2 animate-bounce rounded-full bg-[var(--muted)] motion-reduce:animate-none" style={{ animationDelay: `${k * 0.15}s` }} />)}
          </span>
        </div>
      )}
    </div>
  );
}

export function QuickReplies({ options, onPick, disabled }: { options: string[]; onPick: (t: string) => void; disabled: boolean }) {
  if (!options.length) return null;
  return (
    <div className="flex flex-wrap gap-2" aria-label="Quick replies">
      {options.map((o) => (
        <button key={o} type="button" disabled={disabled} onClick={() => onPick(o)}
          className="chip min-h-9 border border-[var(--accent)] bg-transparent px-4 text-[13px] text-accent-text transition-colors hover:bg-accent-fill hover:text-white disabled:opacity-40">
          {o}
        </button>
      ))}
    </div>
  );
}

export function UndoStartOver({ api }: { api: ConversationApi }) {
  const [asking, setAsking] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className="btn btn-ghost btn-sm" disabled={!api.canUndo || api.busy} onClick={() => api.send("undo", api.state?.mode ?? "chat")}>
        <Undo2 size={15} aria-hidden /> Undo last change
      </button>
      {asking ? (
        <span className="flex items-center gap-2 text-[13px]" role="alertdialog" aria-label="Start over?">
          Start a new booking? This clears the conversation.
          <button type="button" className="btn btn-primary btn-sm" onClick={() => { setAsking(false); void api.startOver(); }}>Start over</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAsking(false)}>Cancel</button>
        </span>
      ) : (
        <button type="button" className="btn btn-ghost btn-sm" disabled={api.busy} onClick={() => setAsking(true)}><RotateCcw size={15} aria-hidden /> Start over</button>
      )}
    </div>
  );
}

export function ChatTab({ api }: { api: ConversationApi }) {
  const [text, setText] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const s = api.state!;
  const send = async (t: string) => {
    const msg = t.trim();
    if (!msg || api.busy) return;
    setText("");
    await api.send(msg, "chat");
    input.current?.focus();
  };
  const review = !!api.result && (s.confirmed || ["review", "blocked", "amber", "done"].includes(s.pending?.kind ?? ""));
  return (
    <div className="space-y-4">
      <div className="card p-4 sm:p-6">
        <MessageList history={s.history} busy={api.busy} />
        <div className="mt-4 space-y-3">
          <QuickReplies options={api.quickReplies} onPick={send} disabled={api.busy} />
          <DiffToast diff={api.lastDiff} onClose={api.clearDiff} />
          {api.error && <p role="alert" className="text-[13px] text-[var(--red-text)]">{api.error}</p>}
          <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
            <label className="sr-only" htmlFor="chat-input">Message</label>
            <textarea id="chat-input" ref={input} value={text} rows={1} maxLength={1200} placeholder="Type your message… (Enter to send, Shift+Enter for a new line)"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(text); } }}
              className="max-h-40 min-h-11 flex-1 resize-y rounded-3xl border hairline bg-surface px-4 py-2.5 text-[15px] outline-none focus:border-[var(--accent)]" />
            <button type="submit" className="btn btn-primary size-11 !p-0" disabled={api.busy || !text.trim()} aria-label="Send"><ArrowUp size={18} /></button>
          </form>
          <UndoStartOver api={api} />
        </div>
      </div>
      {review && api.result && (
        <ReviewCard state={s} result={api.result} onConfirm={async (ack) => {
          const r = await api.send(api.result?.status === "AMBER" && ack ? "Confirm anyway" : "confirm", "chat");
          if (r && !r.state.confirmed && r.state.pendingConfirm?.kind === "amber") {
            const r2 = await api.send("Confirm anyway", "chat");
            return r2?.state.confirmed?.reference ?? null;
          }
          return r?.state.confirmed?.reference ?? null;
        }} />
      )}
    </div>
  );
}
