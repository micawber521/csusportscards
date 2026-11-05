// Contact form handler. Every message is saved in KV (contact:<id>) for
// Gordon's poller, which Telegrams it to Christian. If RESEND_API_KEY and
// CONTACT_TO are set (Cloudflare Secrets), it's also emailed to that address
// with the visitor's address as Reply-To. The destination address is never in
// this repo (it's public) or in any page, so it can't be scraped. The domain's mail is on Proton, so Cloudflare
// Email Routing can't be used for sending.
import type { APIRoute } from "astro";
import { envOf, json } from "../../lib/store";

export const prerender = false;

const RATE_LIMIT = 5;            // messages per visitor per hour
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const clean = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

async function visitorKey(request: Request) {
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip));
  return "rl:contact:" + [...new Uint8Array(hash)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const POST: APIRoute = async ({ request, locals }) => {
  const env = envOf(locals);
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  // Honeypot: real visitors never see or fill the "website" field.
  if (clean(body.website, 200)) return json({ ok: true });

  const name = clean(body.name, 100);
  const email = clean(body.email, 200);
  const order = clean(body.order, 60);
  const message = clean(body.message, 5000);
  if (!name) return json({ error: "Please enter your name." }, 400);
  if (!EMAIL_RE.test(email)) return json({ error: "Please enter a valid email address." }, 400);
  if (message.length < 10) return json({ error: "Please write a little more in your message." }, 400);

  const rl = await visitorKey(request);
  const count = Number((await env.SALES.get(rl)) ?? 0);
  if (count >= RATE_LIMIT) return json({ error: "Too many messages. Please try again in an hour." }, 429);
  await env.SALES.put(rl, String(count + 1), { expirationTtl: 3600 });

  const id = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const record: Record<string, unknown> = { id, name, email, order, message, received_at: new Date().toISOString(), emailed: false };

  if (env.RESEND_API_KEY && env.CONTACT_TO && env.CONTACT_FROM) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: env.CONTACT_FROM,
        to: [env.CONTACT_TO],
        reply_to: email,
        subject: `Contact form: ${name}${order ? ` (order ${order})` : ""}`,
        text: `From: ${name} <${email}>\n${order ? `Order: ${order}\n` : ""}\n${message}\n`,
      }),
    }).catch((e) => { console.error("resend", e); return null; });
    record.emailed = !!res?.ok;
    if (res && !res.ok) console.error("resend", res.status, await res.text().catch(() => ""));
  }

  await env.SALES.put(`contact:${id}`, JSON.stringify(record));
  return json({ ok: true });
};
