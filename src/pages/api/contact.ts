// Contact form handler. Every message is saved in KV (contact:<id>) for
// Gordon's poller, which Telegrams it to Christian. It's also emailed through
// Proton's SMTP server (Cloudflare Workers can open outbound TCP) when the
// SMTP_* and CONTACT_TO Secrets are set. Sender = SMTP_USER, Reply-To = the
// visitor. No address or credential is in this repo (it's public) or any page.
import type { APIRoute } from "astro";
import { WorkerMailer } from "worker-mailer";
import { envOf, json, type Env } from "../../lib/store";

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

  if (env.SMTP_SERVER && env.SMTP_USER && env.SMTP_PASS && env.CONTACT_TO) {
    try {
      await sendMail(env, { name, email, order, message });
      record.emailed = true;
    } catch (e) {
      console.error("smtp", e instanceof Error ? e.message : String(e)); // never logs credentials
    }
  }

  await env.SALES.put(`contact:${id}`, JSON.stringify(record));
  return json({ ok: true });
};

async function sendMail(env: Env, m: { name: string; email: string; order: string; message: string }) {
  const port = Number(env.SMTP_PORT ?? 587);
  await WorkerMailer.send(
    {
      host: env.SMTP_SERVER!,
      port,
      secure: port === 465,      // 465 = TLS from the start; 587 = STARTTLS
      startTls: port !== 465,
      credentials: { username: env.SMTP_USER!, password: env.SMTP_PASS! },
      authType: ["plain", "login"],
      socketTimeoutMs: 15000,
      responseTimeoutMs: 15000,
    },
    {
      from: { name: "CSU Sports Cards website", email: env.SMTP_USER! },
      to: env.CONTACT_TO!,
      reply: { name: m.name, email: m.email },
      subject: `Contact form: ${m.name}${m.order ? ` (order ${m.order})` : ""}`,
      text: `From: ${m.name} <${m.email}>\n${m.order ? `Order: ${m.order}\n` : ""}\n${m.message}\n`,
    },
  );
}
