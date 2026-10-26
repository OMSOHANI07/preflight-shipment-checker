import type { Metadata } from "next";
import Link from "next/link";
import { ResultsView } from "@/components/ResultsView";
import { SiteNav } from "@/components/SiteNav";
import { Footer } from "@/components/StaticSections";
import { loadUpload } from "@/lib/uploads";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Shared results · Ship Eazy" };

export default async function ResultsPage({ params }: PageProps<"/results/[uploadId]">) {
  const { uploadId } = await params;
  const file = await loadUpload(uploadId);
  return (
    <>
      <SiteNav />
      <main className="mx-auto w-full max-w-[1080px] flex-1 px-4 py-12 sm:px-6">
        <p className="eyebrow">Shared results</p>
        {file ? (
          <>
            <h1 className="headline-lg mt-1">{file.fileName}</h1>
            <p className="mt-2 text-[15px] text-muted">
              Saved {new Date(file.checkedAt).toLocaleString("en-GB", { timeZone: "Europe/London", dateStyle: "medium", timeStyle: "short" })} (UK time). The status and dates are as they were when the file was checked.
            </p>
            <div className="mt-10"><ResultsView file={file} saveState="loaded" /></div>
          </>
        ) : (
          <div className="card mt-6 p-10 text-center">
            <h1 className="headline-md">We couldn&apos;t find these results.</h1>
            <p className="mt-3 text-muted">The link may be wrong, or the results database isn&apos;t reachable right now.</p>
          </div>
        )}
        <p className="mt-12 text-center"><Link href="/#app" className="btn btn-primary">Check another file</Link></p>
      </main>
      <Footer />
    </>
  );
}
