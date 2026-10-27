// Server-side helpers shared by the /api routes. Runs in the Cloudflare
// Worker; prices always come from the build's card data, never the browser.
import { byId, shippingCents, heading, type Card } from "./cards";
import { money, type PayPalEnv } from "./paypal";

// One envelope holds up to 6 cards (LISTING_TEMPLATE.md). Bigger orders need
// a different shipping method, which isn't priced yet.
export const MAX_CARDS = 6;

export interface Env extends PayPalEnv {
  SALES: KVNamespace;   // sold:<id> markers + sale:<orderId> records for Gordon
  SALES_TOKEN: string;  // shared with Gordon's poller (projects/csusportscards/poll_sales.py)
}

export const envOf = (locals: App.Locals) => (locals as any).runtime.env as Env;

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// Validates a list of card ids from the browser. Returns the cards or an error.
export function resolveCards(ids: unknown): { cards: Card[] } | { error: string } {
  if (!Array.isArray(ids) || ids.length === 0) return { error: "Your cart is empty." };
  const unique = [...new Set(ids.map(Number))];
  if (unique.length > MAX_CARDS) return { error: `Orders are limited to ${MAX_CARDS} cards for now.` };
  const cards = unique.map((id) => byId.get(id));
  if (cards.some((c) => !c)) return { error: "A card in your cart is no longer available." };
  return { cards: cards as Card[] };
}

export async function soldIds(env: Env, cards: Card[]): Promise<number[]> {
  const hits = await Promise.all(cards.map((c) => env.SALES.get(`sold:${c.id}`)));
  return cards.filter((_, i) => hits[i] !== null).map((c) => c.id);
}

export function orderBody(cards: Card[]) {
  const itemCents = cards.reduce((sum, c) => sum + c.price_cents, 0);
  const shipCents = shippingCents(cards.length);
  return {
    intent: "CAPTURE",
    purchase_units: [{
      reference_id: "csu",
      custom_id: cards.map((c) => c.id).join(","),
      description: "CSU Sports Cards",
      amount: {
        currency_code: "USD",
        value: money(itemCents + shipCents),
        breakdown: {
          item_total: { currency_code: "USD", value: money(itemCents) },
          shipping: { currency_code: "USD", value: money(shipCents) },
        },
      },
      items: cards.map((c) => ({
        name: heading(c).slice(0, 127),
        sku: `CSU-${c.id}`,
        unit_amount: { currency_code: "USD", value: money(c.price_cents) },
        quantity: "1",
        category: "PHYSICAL_GOODS",
      })),
    }],
  };
}
