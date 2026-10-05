# Trinity Insurance Brokers – website

Static rebuild of https://trinity-insures.com (previously Shopify), hosted on GitHub Pages with Supabase for forms, newsletter and the upcoming client portal.

## How it works
| Folder | What it is |
|---|---|
| `content/site.json` | Navigation, footer, contact details, Supabase public key, `basePath` |
| `content/pages/*.json` | One file per page (hero + HTML sections). Edit text here. |
| `content/posts.json` | Blog articles |
| `assets/` | `site.css`, `site.js`, favicon |
| `scripts/build.mjs` | Turns `content/` into the static site in `dist/` (downloads images in CI) |
| `scripts/extract.mjs` | One-time: converts the Shopify snapshot in `raw/` into `content/` |
| `scripts/snapshot.mjs` | Re-snapshots the live Shopify site into `raw/` (Actions → Run workflow → tick snapshot) |
| `supabase/schema.sql` | Tables + RLS policies for forms/newsletter (run once in Supabase SQL editor) |

Every push to `main` rebuilds and deploys via `.github/workflows/deploy.yml`.
Uploading a `bundle.tar.gz` to the repo root also works: the workflow unpacks it, commits, and deploys.

## Local
```
npm install
npm run build        # remote images
npm run serve
```

## Going live on trinity-insures.com
1. Set `basePath` in `content/site.json` to `""`.
2. Settings → Pages → Custom domain → `trinity-insures.com`; update DNS (A records to GitHub Pages IPs, or CNAME for www).
