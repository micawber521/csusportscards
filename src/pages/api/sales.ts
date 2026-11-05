// Gordon's pickup point for new sales (Gordon pulls; nothing pushes into the
// Gordon host). Bearer SALES_TOKEN required.
//   GET  /api/sales                 -> { sales: [...] } not yet acknowledged
//   POST /api/sales {ack: [orderId]} -> moves each sale:<id> to done:<id>
//   POST /api/sales {release: [cardId]} -> clears sold:<id> (undo sandbox test sales)
//   Each sale with a TCG label carries label_pdf_base64 (from label:<orderId>).
//   GET also returns { contacts: [...] } (contact form messages, src/pages/api/contact.ts)
//   POST /api/sales {ack_contacts: [id]} -> deletes contact:<id>
import type { APIRoute } from "astro";
import { envOf, json } from "../../lib/store";

export const prerender = false;

const authorized = (request: Request, token: string) =>
  !!token && request.headers.get("Authorization") === `Bearer ${token}`;

export const GET: APIRoute = async ({ request, locals }) => {
  const env = envOf(locals);
  if (!authorized(request, env.SALES_TOKEN)) return json({ error: "unauthorized" }, 401);
  const { keys } = await env.SALES.list({ prefix: "sale:" });
  const sales = await Promise.all(keys.map(async (k) => {
    const sale = (await env.SALES.get(k.name, "json")) as Record<string, unknown> | null;
    if (!sale) return null;
    const pdf = await env.SALES.get(`label:${sale.order_id}`);
    return pdf ? { ...sale, label_pdf_base64: pdf } : sale;
  }));
  const { keys: ckeys } = await env.SALES.list({ prefix: "contact:" });
  const contacts = await Promise.all(ckeys.map((k) => env.SALES.get(k.name, "json")));
  return json({ sales: sales.filter(Boolean), contacts: contacts.filter(Boolean) });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const env = envOf(locals);
  if (!authorized(request, env.SALES_TOKEN)) return json({ error: "unauthorized" }, 401);
  const { ack, release, ack_contacts } = (await request.json().catch(() => ({}))) as {
    ack?: string[]; release?: number[]; ack_contacts?: string[];
  };
  for (const orderId of ack ?? []) {
    const record = await env.SALES.get(`sale:${orderId}`);
    if (record === null) continue;
    await env.SALES.put(`done:${orderId}`, record);
    await env.SALES.delete(`sale:${orderId}`);
    await env.SALES.delete(`label:${orderId}`);   // Gordon saved the PDF locally
  }
  for (const id of release ?? []) await env.SALES.delete(`sold:${Number(id)}`);
  for (const id of ack_contacts ?? []) await env.SALES.delete(`contact:${String(id)}`);
  return json({ ok: true });
};
