/**
 * Server-only Gemini access. Every call is time-boxed (8 s) and returns null on
 * any failure so callers fall back to deterministic text. The key never leaves
 * the server and is never logged.
 */
import "server-only";
import { GoogleGenAI, ThinkingLevel, type ThinkingConfig } from "@google/genai";

export const GEMINI_TIMEOUT_MS = 8000;
const FALLBACK_MODEL = "gemini-2.5-flash";

let client: GoogleGenAI | null = null;
let modelPromise: Promise<string> | null = null;

export const geminiConfigured = () => !!process.env.GEMINI_API_KEY;

function getClient() {
  if (!process.env.GEMINI_API_KEY) return null;
  client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return client;
}

function withTimeout<T>(p: Promise<T>, ms: number, ctl?: AbortController): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { ctl?.abort(); reject(new Error("timeout")); }, ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/**
 * GEMINI_MODEL if set; otherwise the newest stable "gemini-X.Y-flash" model the key can see
 * (from the official model list — no preview/experimental/lite variants).
 */
export function resolveModel(): Promise<string> {
  const fromEnv = process.env.GEMINI_MODEL?.trim();
  if (fromEnv) return Promise.resolve(fromEnv);
  modelPromise ??= (async () => {
    const ai = getClient();
    if (!ai) return FALLBACK_MODEL;
    try {
      const pager = await withTimeout(ai.models.list({ config: { pageSize: 200 } }), GEMINI_TIMEOUT_MS);
      let best: { name: string; v: number } | null = null;
      for await (const m of pager) {
        const name = (m.name ?? "").replace(/^models\//, "");
        const match = name.match(/^gemini-(\d+(?:\.\d+)?)-flash$/);
        if (!match || !m.supportedActions?.includes("generateContent")) continue;
        const v = parseFloat(match[1]);
        if (!best || v > best.v) best = { name, v };
      }
      return best?.name ?? FALLBACK_MODEL;
    } catch {
      modelPromise = null; // retry discovery on the next request
      return FALLBACK_MODEL;
    }
  })();
  return modelPromise;
}

/**
 * Keep thinking low so calls fit the 8 s time-box: these are rephrasing and yes/no tasks.
 * Gemini 3+ takes a thinking level; 2.x takes a token budget.
 */
const thinkingFor = (model: string): ThinkingConfig =>
  /^gemini-[3-9]/.test(model) ? { thinkingLevel: ThinkingLevel.LOW } : { thinkingBudget: 0 };

/** One JSON-mode call. Returns the parsed JSON or null (timeout, HTTP error, bad JSON, no key). One retry on 429. */
/**
 * The conversation needs ~2 s turns, so it uses a faster Flash model with minimal thinking:
 * GEMINI_CHAT_MODEL if set, else gemini-3.5-flash (a stable Flash model on the key's model list).
 */
export const chatModel = () => process.env.GEMINI_CHAT_MODEL?.trim() || "gemini-3.5-flash";

export async function generateJson(opts: { system: string; prompt: string; schema: unknown; timeoutMs?: number; temperature?: number; model?: string; thinking?: ThinkingConfig }): Promise<unknown | null> {
  const ai = getClient();
  if (!ai) return null;
  const deadline = Date.now() + (opts.timeoutMs ?? GEMINI_TIMEOUT_MS);
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctl = new AbortController();
    try {
      const model = opts.model ?? (await resolveModel());
      const res = await withTimeout(
        ai.models.generateContent({
          model,
          contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
          config: {
            systemInstruction: opts.system,
            responseMimeType: "application/json",
            responseJsonSchema: opts.schema,
            temperature: opts.temperature ?? 0.2,
            thinkingConfig: opts.thinking ?? thinkingFor(model),
            abortSignal: ctl.signal,
          },
        }),
        Math.max(500, deadline - Date.now()),
        ctl,
      );
      const text = (res.text ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
      return text ? JSON.parse(text) : null;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      const rateLimited = /\b429\b|RESOURCE_EXHAUSTED/.test(msg);
      // never log seller data or the key: only the error kind
      console.warn(`[gemini] call failed: ${rateLimited ? "rate limited (429)" : /timeout/.test(msg) ? "timeout" : /JSON/.test(msg) ? "invalid JSON" : "error"}`);
      if (rateLimited && attempt === 0 && deadline - Date.now() > 1500) { await new Promise((r) => setTimeout(r, 700)); continue; }
      return null;
    }
  }
  return null;
}
