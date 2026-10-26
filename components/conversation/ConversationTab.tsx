"use client";

import { MessageSquare, Mic } from "lucide-react";
import { useState } from "react";
import { useConversation } from "@/lib/conversation/useConversation";
import { cx } from "@/lib/ui";
import { ChatTab } from "./ChatTab";
import { SummaryPanel } from "./SummaryPanel";
import { VoiceTab } from "./VoiceTab";

/** Conversation (V2): Chat and Voice share one conversation, one booking and one summary panel. */
export function ConversationTab() {
  const api = useConversation();
  const [sub, setSub] = useState<"chat" | "voice">("chat");
  const tabs = [{ id: "chat" as const, label: "Chat", icon: MessageSquare }, { id: "voice" as const, label: "Voice", icon: Mic }];
  return (
    <div>
      <div className="mb-6 flex justify-center">
        <div role="tablist" aria-label="Conversation mode" className="inline-flex rounded-full bg-surface-2 p-1">
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" id={`conv-tab-${t.id}`} aria-selected={sub === t.id} aria-controls={`conv-panel-${t.id}`} onClick={() => setSub(t.id)}
              className={cx("flex items-center gap-2 rounded-full px-5 py-2 text-[14px] font-medium transition-all", sub === t.id ? "bg-surface text-fg shadow-[var(--shadow)]" : "text-muted hover:text-fg")}>
              <t.icon size={15} aria-hidden /> {t.label}
            </button>
          ))}
        </div>
      </div>
      {!api.state ? (
        <div className="card p-10 text-center text-muted" aria-busy="true">Loading your conversation…</div>
      ) : (
        <div className="grid gap-6 pb-24 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:pb-0">
          <div role="tabpanel" id={`conv-panel-${sub}`} aria-labelledby={`conv-tab-${sub}`} className="min-w-0">
            {sub === "chat" ? <ChatTab api={api} /> : <VoiceTab api={api} onSwitchToChat={() => setSub("chat")} />}
          </div>
          <SummaryPanel state={api.state} result={api.result} changed={api.changedFields} />
        </div>
      )}
    </div>
  );
}
