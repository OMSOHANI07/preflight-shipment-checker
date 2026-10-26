/** GEMINI_MOCK=1: deterministic "Gemini" for Playwright — known demo messages map to fixed extractions; anything else → fallback. */
import { DEMO_EXTRA, DEMO_SCRIPT } from "@/lib/conversation/demo";
import { ExtractionSchema, type Extraction } from "@/lib/conversation/types";

const key = (m: string) => m.trim().toLowerCase();
const TABLE = new Map<string, Record<string, unknown>>();
for (const [m, x] of [...DEMO_SCRIPT, ...DEMO_EXTRA]) if (!TABLE.has(key(m))) TABLE.set(key(m), x);

export const geminiMockEnabled = () => process.env.GEMINI_MOCK === "1";
export function mockExtract(message: string): Extraction | null {
  const x = TABLE.get(key(message));
  return x ? ExtractionSchema.parse(x) : null;
}
