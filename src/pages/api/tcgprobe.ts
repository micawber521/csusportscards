// TEMPORARY (2026-11-04): creates ONE test order through TCG Tracking's API
// from Cloudflare's network (Gordon's office IP is blocked by their host's
// Imunify360) so Christian can see what an API order/label looks like.
// Bearer SALES_TOKEN required; TCG credentials are passed through per request
// and never stored. Fixed target + fixed test payload — not a general proxy.
// Delete after the test.
import type { APIRoute } from "astro";
import { envOf, json } from "../../lib/store";

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const env = envOf(locals);
  if (!env.SALES_TOKEN || request.headers.get("Authorization") !== `Bearer ${env.SALES_TOKEN}`)
    return json({ error: "unauthorized" }, 401);
  // POST must not be silently turned into a GET by a redirect: follow it by hand.
  let url = "https://tcgtracking.com/api/v1/orders";
  const hops: string[] = [];
  const send = (u: string) => fetch(u, {
    method: "POST",
    redirect: "manual",
    headers: {
      "X-Shipper-Number": request.headers.get("X-Shipper-Number") ?? "",
      "X-API-Key": request.headers.get("X-API-Key") ?? "",
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "csusportscards/1.0",
    },
    body: JSON.stringify({
      source_order_id: "CSU-TEST-001",
      ordernum: "CSU-TEST-001",
      customer_name: "John Doe",
      address_line1: "2211 N First St",
      customer_city: "San Jose",
      customer_state: "CA",
      zipcode: "95131",
      customer_country: "US",
      envelope_size: "10",
      is_insured: false,
      items: [
        { name: "TEST CSU-10", quantity: 1, price: 1.25 },
        { name: "TEST CSU-13", quantity: 1, price: 1.25 },
      ],
    }),
  });
  let res = await send(url);
  for (let i = 0; i < 3 && res.status >= 300 && res.status < 400; i++) {
    const loc = res.headers.get("Location");
    if (!loc) break;
    url = new URL(loc, url).toString();
    hops.push(`${res.status} -> ${url}`);
    res = await send(url);
  }
  const text = await res.text();
  return new Response(JSON.stringify({ status: res.status, hops, body: text }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
