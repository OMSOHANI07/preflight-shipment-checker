/**
 * Conversation helpers that sit beside lib/guardrails.ts (which screens every message):
 * invisible-character cleanup, and off-topic questions → "I can only help with this shipment"
 * (Gemini never answers them).
 */

/** Strip invisible / control characters that can hide instructions; collapse whitespace runs. */
export function cleanMessage(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[​-‏‪-‮⁠-⁤﻿]/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[ \t]{3,}/g, "  ")
    .trim();
}

/** Is this question about shipping/booking at all? Off-topic questions are never sent to Gemini. */
const ON_TOPIC = /\b(ship|shipping|shipment|pallet|carton|box|carrier|hs|customs|commodity|tariff|invoice|weight|kg|kilo|deliver|delivery|collect|collection|booking|book|price|cost|charge|freight|eta|arrive|transit|warehouse|slot|appointment|vat|duty|origin|made|lithium|batter|aerosol|flammable|label|export|import|incoterm|declared|value|priority|cheapest|fastest|reliable|road|truck|lorry|route|germany|france|netherlands|berlin|frankfurt|hamburg|paris|lyon|amsterdam|rotterdam|london|manchester|birmingham|leeds|sku|product|item|quantity|units?|pdf|excel|purchase order|po)\b/i;
const OFF_TOPIC = /\b(weather|football|soccer|cricket|recipe|joke|poem|story|politic|election|news|stocks?|crypto|bitcoin|movie|film|song|lyrics|homework|essay|write (me )?(code|a program)|dating|horoscope|celebrity)\b/i;
export const isOnTopic = (q: string) => !OFF_TOPIC.test(q) && ON_TOPIC.test(q);

export const OFF_TOPIC_REPLY = "I can only help with booking this shipment, so I can't answer that.";
