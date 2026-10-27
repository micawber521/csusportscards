// Public checkout config for the cart page. The client ID is not a secret
// (PayPal's button needs it in the page); it's stored as one only so deploys
// don't wipe it.
import type { APIRoute } from "astro";
import { envOf, json, MAX_CARDS } from "../../lib/store";

export const prerender = false;

export const GET: APIRoute = ({ locals }) => {
  const env = envOf(locals);
  return json({ clientId: env.PAYPAL_CLIENT_ID, env: env.PAYPAL_ENV ?? "sandbox", maxCards: MAX_CARDS });
};
