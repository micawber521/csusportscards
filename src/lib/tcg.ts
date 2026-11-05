// TCG Tracking API: creates the envelope order at checkout (SHIPPING_PLAN.md §7).
// The order lands in the TCG dashboard as "Shipped" with an IMb tracking
// number and a #10 label PDF (address + barcode, NO postage). Christian buys
// postage in the dashboard and prints postage-only + the packing slip.
//
// Secrets (Cloudflare): TCG_API_KEY, TCG_SHIPPER_NUMBER. Called from the
// Worker because TCG's host blocks Gordon's office IP.
// Never throws: a failure just means Gordon tells Christian to make it by hand.

import { heading, type Card } from "./cards";

export interface TcgEnv {
  TCG_API_KEY?: string;
  TCG_SHIPPER_NUMBER?: string;
}

export type TcgResult =
  | { ok: true; tracking_number: string; response: Record<string, unknown>; pdf_base64: string | null }
  | { ok: false; error: string };

const URL_ORDERS = "https://tcgtracking.com/api/v1/orders/"; // trailing slash required

export async function createTcgOrder(
  env: TcgEnv,
  o: { orderNum: string; name: string; address: Record<string, string>; cards: Card[] },
): Promise<TcgResult> {
  if (!env.TCG_API_KEY || !env.TCG_SHIPPER_NUMBER) return { ok: false, error: "TCG secrets not set" };
  const a = o.address;
  if (!a.address_line_1 || !a.postal_code) return { ok: false, error: "no ship-to address from PayPal" };

  const body = {
    source_order_id: o.orderNum,          // TCG's duplicate guard
    ordernum: o.orderNum,
    customer_name: o.name,
    address_line1: a.address_line_1,
    address_line2: a.address_line_2 ?? "",
    customer_city: a.admin_area_2 ?? "",
    customer_state: a.admin_area_1 ?? "",
    zipcode: a.postal_code,
    customer_country: a.country_code ?? "US",
    envelope_size: "10",                  // always #10 (Christian 2026-11-04)
    is_insured: false,                    // envelopes are < $50, uninsured
    items: o.cards.map((c) => ({ name: heading(c).slice(0, 100), quantity: 1, price: c.price_cents / 100 })),
  };

  try {
    const res = await fetch(URL_ORDERS, {
      method: "POST",
      headers: {
        "X-Shipper-Number": env.TCG_SHIPPER_NUMBER,
        "X-API-Key": env.TCG_API_KEY,
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "csusportscards/1.0",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
    });
    const text = await res.text();
    let data: Record<string, any> = {};
    try { data = JSON.parse(text); } catch { /* non-JSON error page */ }
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    const tracking = String(data.tracking_number ?? data.data?.tracking_number ?? "");
    if (!tracking) return { ok: false, error: `no tracking number in reply: ${text.slice(0, 200)}` };
    const pdf = (data.pdf_base64 ?? data.data?.pdf_base64 ?? null) as string | null;
    const { pdf_base64: _drop, ...rest } = data;
    return { ok: true, tracking_number: tracking, response: rest, pdf_base64: pdf };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
