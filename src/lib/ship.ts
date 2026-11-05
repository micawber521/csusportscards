// Shipping rules for site orders: picks the mailer, the buyer's shipping
// price, the postage weight and whether to insure. Pure functions with no
// catalog import, so the cart page (browser) and checkout (server) share one
// copy. Source of truth for every number here: ../../SHIPPING_PLAN.md
// (weights from Christian's gram weigh-ins, 2026-11-04).

export type Pack = "sleeve" | "toploader" | "slab" | "pack";
export interface ShipItem { pack: Pack; price_cents: number }

// Item weights in grams (SHIPPING_PLAN.md §6).
export const GRAMS = {
  envelope: 5, slip: 5, strip: 6.7,          // manila strip: 1 per 6 cards, sleeve-only envelopes
  sleeve: 2.5, toploader: 9, slab: 50, pack: 28,
  bubble: 12, stiffeners: 25,                // stiffeners = front + back pair
  box: 150,                                  // GUESS (box + packing), not weighed yet
};
const OZ = 28.3495;
const MARGIN_G = 3;                          // stay this far under an ounce line (locked tiers)

// Envelope (TCG Tracking) limits. Points measure thickness: budget 18 ≈ 1/4".
// Toploader = 6 is a placeholder until the 3-toploaders + sleeves test.
const ENV_POINTS = 18;
const POINTS = { sleeve: 1, toploader: 6 };
const ENV_MAX_TOPLOADERS = 3;
const ENV_VALUE_LIMIT = 5000;                // < $50 card total; TCG Tracking insurance tops out at $50

// Bubble mailer (Pirate Ship) limits. Past these the order goes in a box
// (also Pirate Ship Ground Advantage, the next weight tier up).
const BUBBLE_MAX_G = 453.6 - MARGIN_G;       // 1 lb mailer limit
const BUBBLE_MAX_SLABS = 5;

// Buyer prices (SHIPPING_PLAN.md §5).
const ENV_FIRST = 125, ENV_EACH = 50, ENV_CAP = 600;
const BUBBLE_FLAT = 899;

// Box orders (over 1 lb): buyer pays the zone 8 (worst-case) USPS Ground
// Advantage commercial rate for the weight, rounded up to the next $x.99.
// The buyer's ZIP isn't known when the price is set, so zone 8 means we never
// undercharge. Rates: entities/CardProAI/SHIPPING_RATES.md (USPS Notice 123,
// pulled 2026-09-20; re-check after USPS rate changes).
const GA_ZONE8_BY_LB: [number, number][] = [
  [1, 1067], [2, 1287], [3, 1575], [4, 1801], [5, 1919], [6, 2068],
  [7, 2183], [8, 2290], [9, 2409], [10, 2534], [11, 2737], [12, 2873],
];
const LB = 453.592;
function boxCents(grams: number): number | null {
  const row = GA_ZONE8_BY_LB.find(([lb]) => grams <= lb * LB);
  return row ? Math.ceil((row[1] + 1) / 100) * 100 - 1 : null;
}
const EXTRA_SLAB_CENTS = 0;                  // proposed $1 per slab after the first, not yet approved

// Order cap until box shipping is priced.
export const MAX_ITEMS = 40;

export type ShipPlan =
  | {
      ok: true;
      mailer: "envelope" | "bubble" | "box";
      carrier: "TCG Tracking" | "Pirate Ship";
      buyer_cents: number;
      weight_g: number;
      postage_oz: number;                    // envelope: ounce tier to buy; bubble: rounded-up weight
      insure_cents: number;                  // 0 = uninsured
      counts: Record<Pack, number>;
    }
  | { ok: false; reason: string };

const tally = (items: ShipItem[]) => {
  const counts: Record<Pack, number> = { sleeve: 0, toploader: 0, slab: 0, pack: 0 };
  for (const i of items) counts[i.pack]++;
  return counts;
};

export function envelopeWeight(sleeves: number, toploaders: number): number {
  // Manila strips only go in sleeve-only envelopes; toploaders stiffen the rest.
  const strips = toploaders === 0 ? Math.ceil(sleeves / 6) : 0;
  return GRAMS.envelope + GRAMS.slip + strips * GRAMS.strip + sleeves * GRAMS.sleeve + toploaders * GRAMS.toploader;
}

export function shipPlan(items: ShipItem[]): ShipPlan {
  if (items.length === 0) return { ok: false, reason: "Your cart is empty." };
  if (items.length > MAX_ITEMS) return { ok: false, reason: `Orders are limited to ${MAX_ITEMS} items for now.` };

  const counts = tally(items);
  const value = items.reduce((s, i) => s + i.price_cents, 0);
  const points = counts.sleeve * POINTS.sleeve + counts.toploader * POINTS.toploader;

  const envelopeOk =
    counts.slab === 0 && counts.pack === 0 &&
    counts.toploader <= ENV_MAX_TOPLOADERS &&
    points <= ENV_POINTS &&
    value < ENV_VALUE_LIMIT;

  if (envelopeOk) {
    const w = envelopeWeight(counts.sleeve, counts.toploader);
    return {
      ok: true, mailer: "envelope", carrier: "TCG Tracking",
      buyer_cents: Math.min(ENV_FIRST + ENV_EACH * (items.length - 1), ENV_CAP),
      weight_g: Math.round(w * 10) / 10,
      postage_oz: Math.ceil((w + MARGIN_G) / OZ),
      insure_cents: 0, counts,
    };
  }

  const contents = counts.sleeve * GRAMS.sleeve + counts.toploader * GRAMS.toploader +
    counts.slab * GRAMS.slab + counts.pack * GRAMS.pack;
  const bubbleW = GRAMS.bubble + GRAMS.stiffeners + GRAMS.slip + contents;
  const box = counts.slab > BUBBLE_MAX_SLABS || bubbleW > BUBBLE_MAX_G;
  const w = box ? GRAMS.box + GRAMS.slip + contents : bubbleW;
  const boxPrice = box ? boxCents(w) : null;
  if (box && boxPrice === null) {
    return { ok: false, reason: "This order is too big to ship as one package. Please split it, or contact us." };
  }
  return {
    ok: true, mailer: box ? "box" : "bubble", carrier: "Pirate Ship",
    buyer_cents: box ? boxPrice! : BUBBLE_FLAT + EXTRA_SLAB_CENTS * Math.max(0, counts.slab - 1),
    weight_g: Math.round(w * 10) / 10,
    postage_oz: Math.ceil(w / OZ),
    insure_cents: value >= ENV_VALUE_LIMIT ? value : 0, counts,
  };
}
