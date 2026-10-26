"use client";

import { Info, MessageSquare, Mic, MessagesSquare, Upload } from "lucide-react";
import { useState } from "react";
import { cx } from "@/lib/ui";
import { FileUploadTab } from "./FileUploadTab";

type Tab = "upload" | "conversation";

function ConversationTab() {
  const [msg, setMsg] = useState<string | null>(null);
  const [sub, setSub] = useState<"chat" | "voice">("chat");
  const subTabs = [
    { id: "chat" as const, label: "Chat", icon: MessageSquare },
    { id: "voice" as const, label: "Voice", icon: Mic },
  ];
  return (
    <div className="card p-8 text-center sm:p-14">
      <div role="tablist" aria-label="Conversation mode" className="mx-auto inline-flex rounded-full bg-surface-2 p-1">
        {subTabs.map((t) => (
          <button
            key={t.id} type="button" role="tab" aria-selected={sub === t.id} aria-disabled="true"
            onClick={() => { setSub(t.id); setMsg("Conversation booking arrives in V2."); }}
            className={cx("flex items-center gap-2 rounded-full px-5 py-2 text-[14px] font-medium text-muted", sub === t.id && "bg-surface shadow-[var(--shadow)]")}
          >
            <t.icon size={15} aria-hidden /> {t.label}
            <span className="chip bg-surface text-[11px] text-muted">Coming in V2</span>
          </button>
        ))}
      </div>
      <MessagesSquare size={44} strokeWidth={1.4} className="mx-auto mt-10 text-muted opacity-60" aria-hidden />
      <h3 className="mt-4 text-[26px] font-bold tracking-tight text-muted">Book by chat or voice</h3>
      <p className="mx-auto mt-2 max-w-[520px] text-[17px] text-muted">
        Describe a shipment in plain English and we&apos;ll ask only for what&apos;s missing — using the same rule engine as file upload.
      </p>
      <p role="status" aria-live="polite" className="mt-6 inline-flex items-center gap-2 rounded-full bg-surface-2 px-4 py-2 text-[14px]">
        <Info size={15} aria-hidden /> {msg ?? "Conversation booking arrives in V2."}
      </p>
    </div>
  );
}

export function AppSection() {
  const [tab, setTab] = useState<Tab>("upload");
  const tabs = [
    { id: "upload" as const, label: "File Upload", icon: Upload, badge: null },
    { id: "conversation" as const, label: "Conversation", icon: MessagesSquare, badge: "V2" },
  ];
  const goUpload = () => {
    setTab("upload");
    window.setTimeout(() => document.getElementById("upload")?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
  };
  return (
    <section id="app" aria-label="Checker" className="pb-24">
      {/* Sticky product sub-nav */}
      <div className="sticky top-12 z-40 border-b hairline backdrop-blur-xl backdrop-saturate-150" style={{ background: "var(--nav-bg)" }}>
        <div className="mx-auto flex h-14 max-w-[1080px] items-center justify-between gap-3 px-4 sm:px-6">
          <span className="hidden text-[19px] font-semibold tracking-tight md:block">Checker</span>
          <div role="tablist" aria-label="Input method" className="inline-flex rounded-full bg-surface-2 p-1">
            {tabs.map((t) => (
              <button
                key={t.id} type="button" role="tab" id={`tab-${t.id}`} aria-selected={tab === t.id} aria-controls={`panel-${t.id}`}
                onClick={() => setTab(t.id)}
                className={cx(
                  "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium transition-all sm:px-4 sm:text-[14px]",
                  tab === t.id ? "bg-surface text-fg shadow-[var(--shadow)]" : "text-muted hover:text-fg",
                )}
              >
                <t.icon size={14} aria-hidden className="hidden sm:block" />{t.label}
                {t.badge && <span className="chip bg-surface px-1.5 py-0 text-[10px] text-muted" title="Coming in V2">{t.badge}</span>}
              </button>
            ))}
          </div>
          <button type="button" onClick={goUpload} className="btn btn-primary btn-sm !px-3 sm:!px-4"><span className="sm:hidden">Check</span><span className="hidden sm:inline">Check a file</span></button>
        </div>
      </div>

      <div className="mx-auto mt-12 max-w-[1080px] px-4 sm:px-6">
        <div className="mb-10 text-center">
          <h2 className="headline-lg">Check your bookings.</h2>
          <p className="lede mx-auto mt-3 max-w-[620px]">Every mistake caught, explained and given a fix — before a carrier ever turns up.</p>
        </div>
        <div role="tabpanel" id="panel-upload" aria-labelledby="tab-upload" hidden={tab !== "upload"}>
          <FileUploadTab />
        </div>
        <div role="tabpanel" id="panel-conversation" aria-labelledby="tab-conversation" hidden={tab !== "conversation"}>
          <ConversationTab />
        </div>
      </div>
    </section>
  );
}
