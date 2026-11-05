// Captures a buyer-approved PayPal order, then marks its cards sold and saves
// the sale for Gordon to pick up. Checks the sold list once more right before
// taking the money, so two buyers racing for one card can't both be charged
// (the loser's approved order is simply never captured).
import type { APIRoute } from "astro";
import { paypal } from "../../../../lib/paypal";
import { byId } from "../../../../lib/cards";
import { envOf, itemTaxes, json, soldIds } from "../../../../lib/store";
import { shipPlan } from "../../../../lib/ship";
import { createTcgOrder } from "../../../../lib/tcg";

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

  // Tax check: the tax on the order must match the ship-to PayPal actually has
  // (guards against a buyer faking the state sent to /shipping).
  const shipState = unit?.shipping?.address?.admin_area_1;
  const taxes = itemTaxes(env, ids.map((id) => byId.get(id)!), shipState);
  const expectedTax = taxes.reduce((a, b) => a + b, 0);
  const orderTax = unit?.amount?.breakdown?.tax_total ? cents(unit.amount.breakdown.tax_total.value) : 0;
  if (orderTax !== expectedTax) {
    console.error("tax mismatch", orderId, shipState, orderTax, expectedTax);
    return json({ error: "Your total needs updating for your shipping address. You have not been charged — please try again." }, 409);
  }

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
  const plan = shipPlan(ids.map((id) => byId.get(id)!));

  // Envelope orders: create the TCG Tracking order + label now (the buyer has
  // already paid; a failure here never undoes the sale). Sandbox orders are
  // prefixed TEST- so they're easy to spot and void in the TCG dashboard.
  const live = env.PAYPAL_ENV === "live";
  let tcg: Record<string, unknown> | undefined;
  if (plan.ok && plan.mailer === "envelope") {
    const r = await createTcgOrder(env, {
      orderNum: `${live ? "" : "TEST-"}${orderId}`,
      name: shipTo.name?.full_name ?? "",
      address: shipTo.address ?? {},
      cards: ids.map((id) => byId.get(id)!),
    });
    if (r.ok) {
      tcg = { tracking_number: r.tracking_number, order: r.response.id ?? r.response.order_id ?? null };
      if (r.pdf_base64) await env.SALES.put(`label:${orderId}`, r.pdf_base64);
    } else {
      tcg = { error: r.error };
      console.error("tcg", r.error);
    }
  }
  await env.SALES.put(`sale:${orderId}`, JSON.stringify({
    order_id: orderId,
    capture_id: capture.id,
    env: env.PAYPAL_ENV ?? "sandbox",
    ids,
    items: ids.map((id, i) => ({ id, price_cents: byId.get(id)!.price_cents, tax_cents: taxes[i], pack: byId.get(id)!.pack })),
    tax_cents: expectedTax,
    // How to ship it (src/lib/ship.ts). Gordon's poller puts this in the Telegram alert.
    ship: plan.ok
      ? { mailer: plan.mailer, carrier: plan.carrier, weight_g: plan.weight_g, postage_oz: plan.postage_oz, insure_cents: plan.insure_cents }
      : { mailer: "unknown", error: plan.reason },
    ...(tcg ? { tcg } : {}),
    shipping_cents: breakdown.shipping ? cents(breakdown.shipping.value) : 0,
    total_cents: cents(capture.amount.value),
    buyer: { name: shipTo.name?.full_name ?? "", email: cap.data.payer?.email_address ?? "" },
    ship_to: shipTo.address ?? {},
    captured_at: capture.create_time ?? new Date().toISOString(),
  }));

  return json({ ok: true, order_id: orderId });
};
