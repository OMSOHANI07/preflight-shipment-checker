/**
 * GET /api/voice/token — a short-lived ElevenLabs conversation token (WebRTC) for the voice agent.
 * ELEVENLABS_API_KEY stays on the server: the browser only ever gets the token. Errors are reduced to
 * a kind ("not configured", "rejected", "unreachable") — no key, no upstream body, nothing logged but the status.
 */
import { clientIp, rateLimited } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";
const TIMEOUT_MS = 8_000;

export async function GET(req: Request) {
  if (rateLimited(`voice:${clientIp(req)}`, 10, 60_000)) return Response.json({ error: "Too many voice sessions — please wait a moment." }, { status: 429 });
  const key = process.env.ELEVENLABS_API_KEY?.trim();
  const agent = process.env.ELEVENLABS_AGENT_ID?.trim();
  if (!key || !agent) return Response.json({ error: "Voice isn't set up on this site yet.", kind: "not_configured" }, { status: 503 });

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${encodeURIComponent(agent)}`, {
      headers: { "xi-api-key": key }, cache: "no-store", signal: ctl.signal,
    });
    if (res.status === 401 || res.status === 403) {
      console.warn(`[voice] token request rejected (${res.status})`);
      return Response.json({ error: "The voice service rejected this site's credentials.", kind: "rejected" }, { status: 502 });
    }
    if (res.status === 404 || res.status === 422) {
      console.warn(`[voice] agent not found (${res.status})`);
      return Response.json({ error: "The voice agent couldn't be found.", kind: "agent_missing" }, { status: 502 });
    }
    if (!res.ok) {
      console.warn(`[voice] token request failed (${res.status})`);
      return Response.json({ error: "The voice service isn't responding — please try again.", kind: "unreachable" }, { status: 502 });
    }
    const body = (await res.json().catch(() => null)) as { token?: unknown } | null;
    if (typeof body?.token !== "string" || !body.token) return Response.json({ error: "The voice service sent an unexpected reply.", kind: "unreachable" }, { status: 502 });
    return Response.json({ token: body.token }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    console.warn("[voice] token request failed (network)");
    return Response.json({ error: "Couldn't reach the voice service — check your connection and try again.", kind: "unreachable" }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}
