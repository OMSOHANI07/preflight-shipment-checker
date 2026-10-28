/**
 * Registers the 7 Ship Eazy client tools on the ElevenLabs agent (idempotent).
 *   npx tsx scripts/elevenlabs-setup.ts            # create/attach
 *   npx tsx scripts/elevenlabs-setup.ts --check    # only report what's attached
 * Reads ELEVENLABS_API_KEY / ELEVENLABS_AGENT_ID from the environment (.env.local). Never prints the key.
 * Tools with the same name are reused; existing agent tools are kept (ids are merged, not replaced).
 */
import { VOICE_TOOL_NAMES } from "../lib/voice/tools";

const API = "https://api.elevenlabs.io/v1/convai";
const key = process.env.ELEVENLABS_API_KEY?.trim();
const agent = process.env.ELEVENLABS_AGENT_ID?.trim();
if (!key || !agent) { console.error("ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID must be set (e.g. in .env.local)."); process.exit(1); }

const str = (description: string) => ({ type: "string", description });
const bool = (description: string) => ({ type: "boolean", description });
const none = { type: "object", properties: {}, required: [] as string[] };

/** What each tool is for — the agent reads these descriptions to decide when to call them. */
const TOOLS: Record<(typeof VOICE_TOOL_NAMES)[number], { description: string; parameters: object }> = {
  update_booking: {
    description: "Call this for EVERY seller reply about the shipment — including short answers like 'yes', 'no', 'that's right', numbers, dates, changes, 'undo' and 'fix it'. Pass the seller's EXACT words in 'message' (do not summarise, rephrase or add labels). Ship Eazy's booking engine checks the rules and replies. Then say EXACTLY the text after 'SAY:' — never answer from memory, never set or calculate values yourself. If it lists OPTIONS, offer them.",
    parameters: { type: "object", properties: { message: str("The seller's exact words from their last reply, unchanged (max 1000 characters).") }, required: ["message"] },
  },
  get_booking_summary: {
    description: "Get the current booking: route, products, totals, status, problems, recommended carrier and price. Use it when the seller asks for a summary or what's left to do.",
    parameters: none,
  },
  confirm_booking: {
    description: "Book the shipment when the seller clearly asks to confirm. Set confirm_anyway to true only if the seller has explicitly said to confirm despite the warnings. The booking engine refuses bookings that can't ship yet. Say exactly the text after 'SAY:' and read back any reference letter by letter.",
    parameters: { type: "object", properties: { confirm_anyway: bool("True only when the seller explicitly said 'confirm anyway' after hearing the warnings.") }, required: [] },
  },
  undo_last_change: { description: "Undo the seller's last change to the booking when they ask to undo or go back.", parameters: none },
  start_over: { description: "Clear the booking and start a new one — only after the seller has confirmed they want to start over.", parameters: none },
  download_purchase_order: { description: "Download the purchase order PDF on the seller's screen when they ask for it (usually after booking).", parameters: none },
  download_corrected_excel: { description: "Download the corrected Excel file (Bookings and Items sheets) on the seller's screen when they ask for it.", parameters: none },
};

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, { ...init, headers: { "xi-api-key": key!, "Content-Type": "application/json", ...(init.headers ?? {}) } });
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} → ${res.status} ${(await res.text()).slice(0, 300).replace(key!, "[key]")}`);
  return (await res.json()) as T;
}

interface ToolRow { id: string; tool_config: { name: string; type: string } }

async function main() {
  const check = process.argv.includes("--check");
  const a = await api<{ name?: string; conversation_config?: { agent?: { prompt?: { tool_ids?: string[] } } } }>(`/agents/${encodeURIComponent(agent!)}`);
  const attached = a.conversation_config?.agent?.prompt?.tool_ids ?? [];
  const list = await api<{ tools: ToolRow[] }>("/tools");
  const byName = new Map(list.tools.filter((t) => t.tool_config.type === "client").map((t) => [t.tool_config.name, t.id]));
  console.log(`Agent "${a.name ?? "?"}": ${attached.length} tool(s) attached before.`);
  if (check) {
    for (const n of VOICE_TOOL_NAMES) console.log(`  ${n}: ${byName.has(n) ? (attached.includes(byName.get(n)!) ? "attached" : "exists, not attached") : "missing"}`);
    return;
  }

  const ids: string[] = [];
  for (const name of VOICE_TOOL_NAMES) {
    const tool_config = { type: "client", name, ...TOOLS[name], expects_response: true, response_timeout_secs: 20, execution_mode: "immediate" };
    let id = byName.get(name);
    if (id) {
      await api(`/tools/${id}`, { method: "PATCH", body: JSON.stringify({ tool_config }) });
      console.log(`  updated ${name}`);
    } else {
      id = (await api<{ id: string }>("/tools", { method: "POST", body: JSON.stringify({ tool_config }) })).id;
      console.log(`  created ${name}`);
    }
    ids.push(id);
  }
  const merged = [...new Set([...attached, ...ids])];
  await api(`/agents/${encodeURIComponent(agent!)}`, { method: "PATCH", body: JSON.stringify({ conversation_config: { agent: { prompt: { tool_ids: merged } } } }) });
  const after = (await api<{ conversation_config?: { agent?: { prompt?: { tool_ids?: string[] } } } }>(`/agents/${encodeURIComponent(agent!)}`)).conversation_config?.agent?.prompt?.tool_ids ?? [];
  const missing = ids.filter((x) => !after.includes(x));
  console.log(`Agent now has ${after.length} tool(s); Ship Eazy tools attached: ${ids.length - missing.length}/${ids.length}.`);
  if (missing.length) process.exit(2);
}

main().catch((e) => { console.error(String(e instanceof Error ? e.message : e)); process.exit(1); });
