// Captures a buyer-approved PayPal order, then marks its cards sold and saves
// the sale for Gordon to pick up. Checks the sold list once more right before
// taking the money, so two buyers racing for one card can't both be charged
// (the loser's approved order is simply never captured).
import type { APIRoute } from "astro";
import { paypal } from "../../../../lib/paypal";
import { byId } from "../../../../lib/cards";
import { envOf, json, soldIds } from "../../../../lib/store";

export const prerender = false;

const cents = (v: string) => Math.round(parseFloat(v) * 100);

export const POST: APIRoute = async ({ params, locals }) => {
  const env = envOf(locals);
  const orderId = params.id!;

  const order = await paypal(env, "GET", `/v2/checkout/orders/${encodeURIComponent(orderId)}`);
  if (!order.ok) return json({ error: "Order not found." }, 404);

  const unit = order.data.purchase_units?.[0];
  const ids = String(unit?.custom_id ?? "").split(",").map(Number).filter((n) => byId.has(n));
  if (!ids.length) return json({ error: "Order has no cards." }, 400);

  const sold = await soldIds(env, ids.map((id) => byId.get(id)!));
  if (sold.length) return json({ error: "Sorry — a card in your cart just sold. You have not been charged.", sold }, 409);

  const cap = await paypal(env, "POST", `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {});
  const capture = cap.data.purchase_units?.[0]?.payments?.captures?.[0];
  if (!cap.ok || capture?.status !== "COMPLETED") {
    console.error("paypal capture", cap.status, JSON.stringify(cap.data));
    return json({ error: "Payment didn't go through. You have not been charged." }, 402);
  }

  await Promise.all(ids.map((id) => env.SALES.put(`sold:${id}`, orderId)));

  const shipTo = cap.data.purchase_units?.[0]?.shipping ?? unit?.shipping ?? {};
  const breakdown = unit?.amount?.breakdown ?? {};
  await env.SALES.put(`sale:${orderId}`, JSON.stringify({
    order_id: orderId,
    capture_id: capture.id,
    env: env.PAYPAL_ENV ?? "sandbox",
    ids,
    items: ids.map((id) => ({ id, price_cents: byId.get(id)!.price_cents })),
    shipping_cents: breakdown.shipping ? cents(breakdown.shipping.value) : 0,
    total_cents: cents(capture.amount.value),
    buyer: { name: shipTo.name?.full_name ?? "", email: cap.data.payer?.email_address ?? "" },
    ship_to: shipTo.address ?? {},
    captured_at: capture.create_time ?? new Date().toISOString(),
  }));

  return json({ ok: true, order_id: orderId });
};
