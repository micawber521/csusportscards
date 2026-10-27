// Creates a PayPal order for the cards in the cart. Prices and shipping are
// computed here from the build's card data — the browser only sends ids.
import type { APIRoute } from "astro";
import { paypal } from "../../lib/paypal";
import { envOf, json, orderBody, resolveCards, soldIds } from "../../lib/store";

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const env = envOf(locals);
  const { ids } = (await request.json().catch(() => ({}))) as { ids?: unknown };

  const resolved = resolveCards(ids);
  if ("error" in resolved) return json({ error: resolved.error }, 400);

  const sold = await soldIds(env, resolved.cards);
  if (sold.length) return json({ error: "Some cards in your cart just sold.", sold }, 409);

  const res = await paypal(env, "POST", "/v2/checkout/orders", orderBody(resolved.cards));
  if (!res.ok) {
    console.error("paypal create", res.status, JSON.stringify(res.data));
    return json({ error: "Couldn't start checkout. Please try again." }, 502);
  }
  return json({ id: res.data.id });
};
