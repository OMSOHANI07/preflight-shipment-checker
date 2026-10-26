/**
 * Guardrails that run in code before anything reaches Gemini (and whatever Gemini says):
 * - prompt injection / attempts to change the rules, the status or the assistant → refused;
 * - card, bank or password details → refused and removed from the conversation;
 * - abuse → calm redirect;
 * - off-topic questions → "I can only help with this shipment" (Gemini never answers them).
 * Every refusal is followed by the question we're on, so the seller always knows what to do next.
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

const INJECTION = [
  /\b(ignore|disregard|forget|override|bypass)\b[^.?!]{0,40}\b(instructions?|prompts?|rules?|checks?|guardrails?|system|previous|above|everything)\b/i,
  /\b(system|developer|hidden)\s+(prompt|message|instructions?)\b/i,
  /\b(you are now|act as|pretend (to be|you are)|roleplay as|from now on you)\b/i,
  /\b(jailbreak|dan mode|developer mode|god mode|sudo)\b/i,
  /\b(mark|set|make|change|force|flip|turn)\b[^.?!]{0,30}\b(status|it|this|booking|shipment)\b[^.?!]{0,20}\b(green|ready|approved|passed|ok|valid|cleared)\b/i,
  /\b(skip|turn off|disable|switch off|remove)\b[^.?!]{0,20}\b(checks?|rules?|validation|safety)\b/i,
  /\b(reveal|show|print|repeat|tell me)\b[^.?!]{0,30}\b(api key|secret|prompt|instructions|password|token|env)\b/i,
  /<\/?\s*(seller_message|system|script|iframe|img|svg)\b/i,
  /\b(drop|delete|truncate)\s+table\b|;\s*--|\bunion\s+select\b/i,
];

const ABUSE = /\b(f+u+c+k+|sh[i1]t|bastard|bitch|c+u+n+t|idiot|stupid bot|useless bot|dickhead|wanker)\b/i;

function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}
function hasCard(text: string): boolean {
  for (const m of text.matchAll(/\b(?:\d[ -]?){13,19}\b/g)) {
    const d = m[0].replace(/\D/g, "");
    if (d.length >= 13 && d.length <= 19 && luhn(d) && !/^(\d)\1+$/.test(d)) return true;
  }
  return false;
}
const BANK = /\b(sort ?code|account (no|number)|iban|swift|bic|cvv|cvc|security code|pin number|password|passcode|one[- ]time code|otp)\b|\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/i;

export type GuardKind = "injection" | "payment" | "abuse";
export interface GuardHit { kind: GuardKind; reply: string; redact?: string }

export function guardMessage(text: string): GuardHit | null {
  if (hasCard(text) || BANK.test(text))
    return { kind: "payment", redact: "[removed — payment or security details]", reply: "Please don't share card, bank or password details here — Ship Eazy never needs them, and I haven't kept that message." };
  if (INJECTION.some((r) => r.test(text)))
    return { kind: "injection", reply: "I can't do that. The checks and the status come from the shipping rules, and nobody can change or switch them off in this chat — me included." };
  if (ABUSE.test(text))
    return { kind: "abuse", reply: "Let's keep it to the booking — I'm here to get your shipment out without problems." };
  return null;
}

/** Is this question about shipping/booking at all? Off-topic questions are never sent to Gemini. */
const ON_TOPIC = /\b(ship|shipping|shipment|pallet|carton|box|carrier|hs|customs|commodity|tariff|invoice|weight|kg|kilo|deliver|delivery|collect|collection|booking|book|price|cost|charge|freight|eta|arrive|transit|warehouse|slot|appointment|vat|duty|origin|made|lithium|batter|aerosol|flammable|label|export|import|incoterm|declared|value|priority|cheapest|fastest|reliable|road|truck|lorry|route|germany|france|netherlands|berlin|frankfurt|hamburg|paris|lyon|amsterdam|rotterdam|london|manchester|birmingham|leeds|sku|product|item|quantity|units?|pdf|excel|purchase order|po)\b/i;
const OFF_TOPIC = /\b(weather|football|soccer|cricket|recipe|joke|poem|story|politic|election|news|stocks?|crypto|bitcoin|movie|film|song|lyrics|homework|essay|write (me )?(code|a program)|dating|horoscope|celebrity)\b/i;
export const isOnTopic = (q: string) => !OFF_TOPIC.test(q) && ON_TOPIC.test(q);

export const OFF_TOPIC_REPLY = "I can only help with booking this shipment, so I can't answer that.";
