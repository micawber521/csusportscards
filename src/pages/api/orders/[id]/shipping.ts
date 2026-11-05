// Called by the cart's PayPal onShippingAddressChange (before the buyer
// approves): re-prices the order for the chosen ship-to state, adding Missouri
// sales tax for MO addresses, and PATCHes the PayPal order so the buyer sees
// the final total. The browser's state value isn't trusted for money: capture
// re-checks the tax against the address PayPal actually has.
import type { APIRoute } from "astro";
import { paypal } from "../../../../lib/paypal";
import { byId } from "../../../../lib/cards";
import { shipPlan } from "../../../../lib/ship";
import { amountAndItems, envOf, itemTaxes, json } from "../../../../lib/store";

export const prerender = false;

export const POST: APIRoute = async ({ params, request, locals }) => {
  const env = envOf(locals);
  const orderId = params.id!;
  const { state, country } = (await request.json().catch(() => ({}))) as { state?: string; country?: string };
  if (country && country !== "US") return json({ error: "We only ship within the US." }, 422);

  const order = await paypal(env, "GET", `/v2/checkout/orders/${encodeURIComponent(orderId)}`);
  if (!order.ok) return json({ error: "Order not found." }, 404);
  const ids = String(order.data.purchase_units?.[0]?.custom_id ?? "").split(",").map(Number).filter((n) => byId.has(n));
  const cards = ids.map((id) => byId.get(id)!);
  const plan = shipPlan(cards);
  if (!cards.length || !plan.ok) return json({ error: "Order can't be priced." }, 400);

  const { amount, items } = amountAndItems(cards, plan.buyer_cents, itemTaxes(env, cards, state));
  const res = await paypal(env, "PATCH", `/v2/checkout/orders/${encodeURIComponent(orderId)}`, [
    { op: "replace", path: "/purchase_units/@reference_id=='csu'/amount", value: amount },
    { op: "replace", path: "/purchase_units/@reference_id=='csu'/items", value: items },
  ]);
  if (!res.ok) {
    console.error("paypal patch", res.status, JSON.stringify(res.data));
    return json({ error: "Couldn't update the total." }, 502);
  }
  return json({ ok: true, total: amount.value });
};
