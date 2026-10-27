# csusportscards.com

Storefront for CSU Sports Cards. Design: `../DESIGN.md`.

- Deploys via Cloudflare Git integration on push to `main` (no wrangler auth on the Gordon host).
- Push access: repo-scoped deploy key `~/.ssh/csusportscards_deploy`, ssh alias `github-csusportscards`.
- Local build: `npm install && npm run build`.
