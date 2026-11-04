// TEMPORARY (2026-11-04): one-off probe to see whether TCG Tracking's API
// answers requests coming from Cloudflare's network (Gordon's office IP is
// blocked by their host's Imunify360). Bearer SALES_TOKEN required; the TCG
// credentials are passed through per request and never stored here. Fixed
// target URL only — not a general proxy. Delete after the test.
import type { APIRoute } from "astro";
import { envOf, json } from "../../lib/store";

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const env = envOf(locals);
  if (!env.SALES_TOKEN || request.headers.get("Authorization") !== `Bearer ${env.SALES_TOKEN}`)
    return json({ error: "unauthorized" }, 401);
  const res = await fetch("https://tcgtracking.com/api/v1/orders/track?order_number=CSU-TEST-000", {
    headers: {
      "X-Shipper-Number": request.headers.get("X-Shipper-Number") ?? "",
      "X-API-Key": request.headers.get("X-API-Key") ?? "",
      Accept: "application/json",
      "User-Agent": "csusportscards/1.0",
    },
  });
  const body = (await res.text()).slice(0, 400);
  return json({ status: res.status, content_type: res.headers.get("content-type"), body });
};
