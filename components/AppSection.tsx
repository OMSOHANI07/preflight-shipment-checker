"use client";

import { MessagesSquare, Upload } from "lucide-react";
import { useState } from "react";
import { cx } from "@/lib/ui";
import { ConversationTab } from "./conversation/ConversationTab";
import { FileUploadTab } from "./FileUploadTab";

type Tab = "upload" | "conversation";

export function AppSection() {
  const [tab, setTab] = useState<Tab>("upload");
  const tabs = [
    { id: "upload" as const, label: "File Upload", icon: Upload },
    { id: "conversation" as const, label: "Conversation", icon: MessagesSquare },
  ];
  const goUpload = () => {
    setTab("upload");
    window.setTimeout(() => document.getElementById("upload")?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
  };
  return (
    <section id="app" aria-label="Checker" className="section-glass pb-24">
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
