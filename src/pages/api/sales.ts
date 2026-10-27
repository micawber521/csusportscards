// Gordon's pickup point for new sales (Gordon pulls; nothing pushes into the
// Gordon host). Bearer SALES_TOKEN required.
//   GET  /api/sales                 -> { sales: [...] } not yet acknowledged
//   POST /api/sales {ack: [orderId]} -> moves each sale:<id> to done:<id>
//   POST /api/sales {release: [cardId]} -> clears sold:<id> (undo sandbox test sales)
import type { APIRoute } from "astro";
import { envOf, json } from "../../lib/store";

export const prerender = false;

const authorized = (request: Request, token: string) =>
  !!token && request.headers.get("Authorization") === `Bearer ${token}`;

export const GET: APIRoute = async ({ request, locals }) => {
  const env = envOf(locals);
  if (!authorized(request, env.SALES_TOKEN)) return json({ error: "unauthorized" }, 401);
  const { keys } = await env.SALES.list({ prefix: "sale:" });
  const sales = await Promise.all(keys.map((k) => env.SALES.get(k.name, "json")));
  return json({ sales: sales.filter(Boolean) });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const env = envOf(locals);
  if (!authorized(request, env.SALES_TOKEN)) return json({ error: "unauthorized" }, 401);
  const { ack, release } = (await request.json().catch(() => ({}))) as { ack?: string[]; release?: number[] };
  for (const orderId of ack ?? []) {
    const record = await env.SALES.get(`sale:${orderId}`);
    if (record === null) continue;
    await env.SALES.put(`done:${orderId}`, record);
    await env.SALES.delete(`sale:${orderId}`);
  }
  for (const id of release ?? []) await env.SALES.delete(`sold:${Number(id)}`);
  return json({ ok: true });
};
