// Snapshot the live Shopify site (trinity-insures.com) into raw/ as stripped HTML.
// Runs in GitHub Actions (node 20, no deps).
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const BASE = 'https://trinity-insures.com';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const SKIP = /\/pages\/(sample-page|quotes-history|gdpr-compliance|ccpa-compliance|thank-you|cocolife-survey-test|test-contact|welcome|news|videos|contact|our-offerings|offerings|others)$/;

const get = async (u, tries = 3) => {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(u.startsWith('http') ? u : BASE + u, { headers: { 'user-agent': UA } });
      if (r.ok) return await r.text();
      console.warn('HTTP', r.status, u);
      if (r.status === 404) return null;
    } catch (e) { console.warn('ERR', u, e.message); }
    await new Promise(r => setTimeout(r, 1500 * (i + 1)));
  }
  return null;
};
const locs = xml => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].replace(/&amp;/g, '&'));
const strip = html => html
  .replace(/<script\b[\s\S]*?<\/script>/gi, '')
  .replace(/<style\b[\s\S]*?<\/style>/gi, '')
  .replace(/<svg\b[\s\S]*?<\/svg>/gi, '')
  .replace(/<!--[\s\S]*?-->/g, '');

const index = await get('/sitemap.xml');
let urls = new Set(['/', '/pages/payments', '/blogs/news', '/blogs/videos', '/search', '/account/login']);
for (const sm of locs(index)) {
  const xml = await get(sm);
  if (!xml) continue;
  for (const u of locs(xml)) {
    if (!u.startsWith(BASE)) continue;
    const p = u.replace(BASE, '') || '/';
    if (p.includes('/cdn/') || p.endsWith('.md') || SKIP.test(p)) continue;
    urls.add(p);
  }
}
// blog index pagination
const blogFirst = await get('/blogs/news');
const maxPage = Math.max(1, ...[...(blogFirst || '').matchAll(/\/blogs\/news\?page=(\d+)/g)].map(m => +m[1]));
for (let i = 2; i <= maxPage; i++) urls.add(`/blogs/news?page=${i}`);

urls = [...urls];
console.log('URLs:', urls.length);
const manifest = [];
let n = 0;
const queue = [...urls];
async function worker() {
  while (queue.length) {
    const p = queue.shift();
    const html = await get(p);
    if (!html) { manifest.push({ path: p, ok: false }); continue; }
    const file = 'raw' + (p === '/' ? '/index' : p.replace('?page=', '__page_')) + '.html';
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, strip(html));
    manifest.push({ path: p, file, ok: true });
    if (++n % 25 === 0) console.log(n, 'saved');
  }
}
await Promise.all(Array.from({ length: 6 }, worker));
manifest.sort((a, b) => a.path.localeCompare(b.path));
await writeFile('raw/manifest.json', JSON.stringify(manifest, null, 1));
console.log('done', manifest.filter(m => m.ok).length, '/', manifest.length);
