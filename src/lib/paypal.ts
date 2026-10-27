// PayPal Orders v2, called only from the server (Cloudflare Worker). The
// client secret never reaches the browser.
//
// Env (Cloudflare → csu project → Settings → Runtime variables and secrets):
//   PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET  — Secret type
//   PAYPAL_ENV                              — "sandbox" | "live", set in wrangler.json vars

export interface PayPalEnv {
  PAYPAL_CLIENT_ID: string;
  PAYPAL_CLIENT_SECRET: string;
  PAYPAL_ENV?: string;
}

const base = (env: PayPalEnv) =>
  env.PAYPAL_ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";

async function token(env: PayPalEnv): Promise<string> {
  const res = await fetch(`${base(env)}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`paypal auth ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

export async function paypal(env: PayPalEnv, method: string, path: string, body?: unknown) {
  const res = await fetch(`${base(env)}${path}`, {
    method,
    headers: { Authorization: `Bearer ${await token(env)}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as any;
  return { ok: res.ok, status: res.status, data };
}

export const money = (cents: number) => (cents / 100).toFixed(2);
