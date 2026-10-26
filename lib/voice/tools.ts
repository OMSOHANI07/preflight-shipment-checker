/**
 * ElevenLabs client tools for the voice agent. The agent does the talking; every booking change still
 * goes through the same turn engine as Chat (/api/chat → rules, guardrails, maths), so the voice agent
 * can never set a value, a status or a price on its own. Each tool returns short plain text for the
 * agent to act on. Tool names and parameters must match the agent's tool settings in ElevenLabs.
 */
import { formatDDMMYYYY, gbp, type BookingResult } from "@/lib/calculations";
import type { ConversationState, TurnResponse } from "@/lib/conversation/types";
import { STATUS_LABEL } from "@/lib/ui";

export interface VoiceToolApi {
  getState: () => ConversationState | null;
  getResult: () => BookingResult | null;
  send: (text: string) => Promise<TurnResponse | null>;
  startOver: () => Promise<void>;
  download: (which: "po" | "xlsx") => Promise<void>;
}

const MAX_TOOL_MESSAGE = 1000;

/** What the agent hears back after a turn: what to say, the status, and the next question's options. */
export function describeTurn(r: TurnResponse | null): string {
  if (!r) return "ERROR: the booking service didn't respond. Say sorry, there was a problem, and ask the seller to repeat that.";
  const status = r.result ? STATUS_LABEL[r.result.status] : "not checked yet";
  const opts = r.quickReplies.length ? ` OPTIONS: ${r.quickReplies.join(" | ")}.` : "";
  const ref = r.state.confirmed ? ` BOOKED: reference ${r.state.confirmed.reference}.` : "";
  return `SAY: ${r.speak}${ref} STATUS: ${status}.${opts}`;
}

export function bookingSummary(s: ConversationState | null, r: BookingResult | null): string {
  if (!s) return "No booking yet.";
  const b = s.booking;
  const parts = [
    b.sellerName ? `Seller ${b.sellerName}` : null,
    b.originCity || b.destinationCity ? `${b.originCity ?? "?"} to ${b.destinationCity ?? "?"}${b.destinationCountry ? ` (${b.destinationCountry})` : ""}` : null,
    b.destinationType ? `delivering to a ${b.destinationType.toLowerCase()}` : null,
    b.readyToShipDate ? `ready ${formatDDMMYYYY(b.readyToShipDate)}` : null,
    b.sellerPriority ? `priority ${b.sellerPriority}` : null,
    b.pallets != null ? `${b.pallets} pallets` : null,
    b.cartons != null ? `${b.cartons} cartons` : null,
    b.totalGrossWeightKg != null ? `${b.totalGrossWeightKg} kg` : null,
    b.totalDeclaredValue != null ? `declared ${gbp(b.totalDeclaredValue)}` : null,
  ].filter(Boolean);
  const items = s.items.map((it) => `${it.sku ?? "?"} ${it.description ?? ""}: ${it.quantity ?? "?"} units at ${it.unitPrice != null ? gbp(it.unitPrice) : "?"}`.trim());
  const issues = r?.issues.filter((i) => i.severity !== "Advisory").map((i) => `${i.code} ${i.title}`) ?? [];
  const best = r?.recommendation.recommended;
  return [
    parts.length ? parts.join(", ") + "." : "No details yet.",
    items.length ? `Products: ${items.join("; ")}.` : "No products yet.",
    `Status: ${r ? STATUS_LABEL[r.status] : "not checked yet"}.`,
    issues.length ? `Problems: ${issues.join("; ")}.` : "",
    best ? `${r!.recommendation.label}: ${best.carrier.carrier} ${best.carrier.service}, ${gbp(best.cost)}, estimated delivery ${best.etaDate ? formatDDMMYYYY(best.etaDate) : "unknown"}.` : "",
    s.confirmed ? `Booked, reference ${s.confirmed.reference}.` : "",
  ].filter(Boolean).join(" ");
}

export function makeVoiceTools(api: VoiceToolApi) {
  return {
    /** Everything the seller says that's about the booking goes here, in their own words. */
    update_booking: async (p: { message?: unknown }) => {
      const text = typeof p?.message === "string" ? p.message.trim().slice(0, MAX_TOOL_MESSAGE) : "";
      if (!text) return "ERROR: no message. Pass what the seller said in 'message'.";
      return describeTurn(await api.send(text));
    },
    get_booking_summary: async () => bookingSummary(api.getState(), api.getResult()),
    /** Book it. The rules decide: can't-ship / details-missing bookings are refused; warnings need confirm_anyway. */
    confirm_booking: async (p: { confirm_anyway?: unknown }) => describeTurn(await api.send(p?.confirm_anyway === true ? "Confirm anyway" : "confirm")),
    undo_last_change: async () => describeTurn(await api.send("undo")),
    start_over: async () => { await api.startOver(); return "Started a new booking. SAY: Okay — let's start again. Where's the shipment going, what's in it, and when will it be ready?"; },
    download_purchase_order: async () => {
      if (!api.getResult()) return "ERROR: there's no booking to make a purchase order for yet.";
      await api.download("po"); return "The purchase order PDF has been downloaded on the seller's screen.";
    },
    download_corrected_excel: async () => {
      if (!api.getResult()) return "ERROR: there's no booking to export yet.";
      await api.download("xlsx"); return "The corrected Excel file has been downloaded on the seller's screen.";
    },
  };
}

export const VOICE_TOOL_NAMES = ["update_booking", "get_booking_summary", "confirm_booking", "undo_last_change", "start_over", "download_purchase_order", "download_corrected_excel"] as const;
