// Server-side helpers shared by the /api routes. Runs in the Cloudflare
// Worker; prices always come from the build's card data, never the browser.
import { byId, heading, type Card } from "./cards";
import { shipPlan, type ShipPlan } from "./ship";
import { money, type PayPalEnv } from "./paypal";
import type { TcgEnv } from "./tcg";


export interface Env extends PayPalEnv, TcgEnv {
  SALES: KVNamespace;   // sold:<id> markers + sale:<orderId> records for Gordon
  SALES_TOKEN: string;  // shared with Gordon's poller (projects/csusportscards/poll_sales.py)
  // Optional Secrets for emailing contact-form messages through Proton SMTP.
  // Kept out of the (public) repo so addresses/credentials can't be scraped.
  SMTP_SERVER?: string;
  SMTP_PORT?: string;
  SMTP_USER?: string;      // also the From address
  SMTP_PASS?: string;      // Proton SMTP token (send-only)
  CONTACT_TO?: string;     // destination inbox
  MO_TAX_RATE?: string;    // wrangler.json var, percent, e.g. "7.725" (Bertrand, MO)
}

export const envOf = (locals: App.Locals) => (locals as any).runtime.env as Env;

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// Validates a list of card ids from the browser and works out shipping.
// Returns the cards + ship plan, or an error.
export function resolveCards(ids: unknown): { cards: Card[]; ship: Extract<ShipPlan, { ok: true }> } | { error: string } {
  if (!Array.isArray(ids) || ids.length === 0) return { error: "Your cart is empty." };
  const unique = [...new Set(ids.map(Number))];
  const cards = unique.map((id) => byId.get(id));
  if (cards.some((c) => !c)) return { error: "A card in your cart is no longer available." };
  const ship = shipPlan(cards as Card[]);
  if (!ship.ok) return { error: ship.reason };
  return { cards: cards as Card[], ship };
}

export async function soldIds(env: Env, cards: Card[]): Promise<number[]> {
  const hits = await Promise.all(cards.map((c) => env.SALES.get(`sold:${c.id}`)));
  return cards.filter((_, i) => hits[i] !== null).map((c) => c.id);
}

// KV key holding the ids Gordon says are no longer for sale (relisted or sold on
// eBay, any status other than 'ended' in cards.db). Gordon's poller pushes it every
// few minutes via POST /api/sales {unavailable}, so checkout is never more than a
// poll behind cards.db even though the catalog itself only rebuilds once a day.
export const UNAVAILABLE_KEY = "unavailable";

// "Something is waiting for Gordon" flag. Set whenever a sale:* or contact:*
// record is written, so Gordon's 5-minute poll can do one cheap KV read instead
// of two KV lists (free plan: 1,000 lists/day, 288 polls/day). Cleared by
// GET /api/sales when it lists and finds nothing left.
export const PENDING_KEY = "pending";
export const markPending = (env: Env) => env.SALES.put(PENDING_KEY, String(Date.now()));

export async function unavailableSet(env: Env): Promise<Set<number>> {
  const list = (await env.SALES.get(UNAVAILABLE_KEY, "json")) as number[] | null;
  return new Set(Array.isArray(list) ? list.map(Number) : []);
}

// Cards that can't be bought right now: sold on the site OR flagged by Gordon.
export async function unavailableIds(env: Env, cards: Card[]): Promise<number[]> {
  const [sold, flagged] = await Promise.all([soldIds(env, cards), unavailableSet(env)]);
  const out = new Set(sold);
  for (const c of cards) if (flagged.has(c.id)) out.add(c.id);
  return [...out];
}

// Missouri sales tax: charged only when the PayPal ship-to state is MO, at the
// seller-location rate (MO in-state sales are origin-based). Computed per item
// (PayPal requires tax_total = sum of item taxes) on card prices only; the
// separately stated shipping charge is not taxed.
export function itemTaxes(env: Env, cards: Card[], state: string | undefined): number[] {
  const rate = Number(env.MO_TAX_RATE ?? 0);
  if ((state ?? "").toUpperCase() !== "MO" || !(rate > 0)) return cards.map(() => 0);
  return cards.map((c) => Math.round((c.price_cents * rate) / 100));
}

export function amountAndItems(cards: Card[], shipCents: number, taxes: number[]) {
  const itemCents = cards.reduce((sum, c) => sum + c.price_cents, 0);
  const taxCents = taxes.reduce((a, b) => a + b, 0);
  const usd = (cents: number) => ({ currency_code: "USD", value: money(cents) });
  return {
    amount: {
      currency_code: "USD",
      value: money(itemCents + shipCents + taxCents),
      breakdown: {
        item_total: usd(itemCents),
        shipping: usd(shipCents),
        ...(taxCents ? { tax_total: usd(taxCents) } : {}),
      },
    },
    items: cards.map((c, i) => ({
      name: heading(c).slice(0, 127),
      sku: `CSU-${c.id}`,
      unit_amount: usd(c.price_cents),
      ...(taxCents ? { tax: usd(taxes[i]) } : {}),
      quantity: "1",
      category: "PHYSICAL_GOODS",
    })),
  };
}

export function orderBody(cards: Card[], shipCents: number) {
  // Tax starts at 0; the cart's onShippingAddressChange adds it for MO buyers.
  const { amount, items } = amountAndItems(cards, shipCents, cards.map(() => 0));
  return {
    intent: "CAPTURE",
    purchase_units: [{
      reference_id: "csu",
      custom_id: cards.map((c) => c.id).join(","),
      description: "CSU Sports Cards",
      amount,
      items,
    }],
  };
}
