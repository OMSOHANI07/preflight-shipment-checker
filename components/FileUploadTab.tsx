"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check, FileSpreadsheet, Loader2, TriangleAlert, UploadCloud } from "lucide-react";
import { useRef, useState } from "react";
import { checkWorkbook, saveCheckedFile, type Step } from "@/lib/checkFile";
import type { FileNotice } from "@/lib/parseExcel";
import type { CheckedFile } from "@/lib/types";
import { cx } from "@/lib/ui";
import { ResultsView } from "./ResultsView";

const STEPS: { id: Exclude<Step, "done">; label: string }[] = [
  { id: "read", label: "Reading file" },
  { id: "check", label: "Checking 10 rules" },
  { id: "carriers", label: "Choosing carriers" },
];
const ORDER: Step[] = ["read", "check", "carriers", "done"];

export function FileUploadTab() {
  const reduce = useReducedMotion();
  const input = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState(false);
  const [step, setStep] = useState<Step | null>(null);
  const [error, setError] = useState<{ message: string; notices: FileNotice[] } | null>(null);
  const [file, setFile] = useState<CheckedFile | null>(null);
  const [saveState, setSaveState] = useState<"saving" | "saved" | "failed">("saving");

  async function run(data: ArrayBuffer, name: string) {
    setError(null);
    setFile(null);
    setStep("read");
    const pause = (ms: number) => new Promise((r) => setTimeout(r, reduce ? 0 : ms));
    const out = await checkWorkbook(data, name, (s) => setStep(s));
    await pause(350);
    if (!out.ok) { setStep(null); setError({ message: out.error, notices: out.notices }); return; }
    setStep("done");
    setFile(out.file);
    setSaveState("saving");
    window.setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" }), 150);
    const saved = await saveCheckedFile(out.file);
    if (saved) {
      setFile((f) => (f ? { ...f, uploadId: saved.uploadId, views: f.views.map((v, i) => ({ ...v, rowId: saved.rowIds[i] ?? null })) } : f));
      setSaveState("saved");
    } else setSaveState("failed");
  }

  async function onFiles(files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) { setError({ message: "That file is over 10 MB. Upload just the Bookings and Items sheets.", notices: [] }); return; }
    await run(await f.arrayBuffer(), f.name);
  }

  const busy = step !== null && step !== "done";
  const idx = step ? ORDER.indexOf(step) : -1;

  return (
    <div className="space-y-10">
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); void onFiles(e.dataTransfer.files); }}
        className={cx("card relative border-2 border-dashed p-8 text-center transition-all sm:p-14", drag ? "scale-[1.01] border-[var(--accent)]" : "border-transparent")}
        id="upload"
      >
        <UploadCloud size={48} strokeWidth={1.4} className="mx-auto text-accent-text" aria-hidden />
        <h3 className="mt-4 text-[28px] font-bold tracking-tight">Drop your Bookings &amp; Items file</h3>
        <p className="mx-auto mt-2 max-w-[520px] text-[17px] text-muted">An .xlsx or .xls in the template format. It&apos;s checked in your browser in seconds.</p>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <button type="button" className="btn btn-primary" onClick={() => input.current?.click()} disabled={busy}>
            <FileSpreadsheet size={17} aria-hidden /> Choose file
          </button>
        </div>
        <p className="mt-4 text-[13px] text-muted">No file to hand? Use the Excel template download at the top of the page, or describe the shipment in Conversation.</p>
        <input ref={input} type="file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" className="sr-only" aria-label="Choose an Excel file" onChange={(e) => { void onFiles(e.target.files); e.target.value = ""; }} />

        <AnimatePresence>
          {step && step !== "done" && (
            <motion.ol initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mx-auto mt-8 flex max-w-[560px] flex-col gap-2 text-left sm:flex-row sm:justify-center sm:gap-6" aria-live="polite">
              {STEPS.map((s, i) => {
                const state = i < idx ? "done" : i === idx ? "active" : "todo";
                return (
                  <li key={s.id} className={cx("flex items-center gap-2 text-[14px]", state === "todo" && "text-muted")}>
                    {state === "done" ? <Check size={16} className="text-[var(--green-text)]" aria-hidden /> : state === "active" ? <Loader2 size={16} className="animate-spin text-accent-text motion-reduce:animate-none" aria-hidden /> : <span className="size-4 rounded-full border hairline" aria-hidden />}
                    {s.label}
                  </li>
                );
              })}
            </motion.ol>
          )}
        </AnimatePresence>
      </div>

      {error && (
        <div role="alert" className="sev-red rounded-[20px] p-5" style={{ background: "var(--sev-tint)" }}>
          <p className="flex items-start gap-2 font-semibold" style={{ color: "var(--sev-text)" }}><TriangleAlert size={18} className="mt-0.5 flex-none" aria-hidden />{error.message}</p>
          {error.notices.map((n, i) => <p key={i} className="mt-2 text-[14px] text-muted">{n.message}</p>)}
          <p className="mt-3 text-[14px]">Need the format? <a className="text-accent-text underline" href="/samples/template.xlsx" download="Ship_Eazy_Excel_Template.xlsx">Excel template download</a>.</p>
        </div>
      )}

      <div ref={resultsRef} className="scroll-mt-32">
        {file && <ResultsView file={file} saveState={saveState} />}
      </div>
    </div>
  );
}
