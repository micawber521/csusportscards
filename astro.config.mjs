// @ts-check
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import cloudflare from "@astrojs/cloudflare";

// Same stack as projects/astro-cft (cftrust.org): static pages, deployed by
// Cloudflare's Git integration on push to main. The adapter is here so the
// PayPal checkout endpoint can be added later without changing the setup.
export default defineConfig({
  site: "https://csusportscards.com",
  integrations: [sitemap()],
  adapter: cloudflare({ platformProxy: { enabled: true } }),
});
