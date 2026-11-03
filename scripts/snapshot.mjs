// Snapshot the live Shopify site (trinity-insures.com) into raw/ as stripped HTML.
// Runs in GitHub Actions (node 20, no deps).
import { mkdir, writeFile, access } from 'node:fs/promises';
import { dirname } from 'node:path';

const BASE = 'https://trinity-insures.com';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const SKIP = /\/pages\/(sample-page|quotes-history|gdpr-compliance|ccpa-compliance|thank-you|cocolife-survey-test|test-contact|welcome|news|videos|contact|our-offerings|offerings|others)$/;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = async (u, tries = 7) => {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(u.startsWith('http') ? u : BASE + u, { headers: { 'user-agent': UA } });
      if (r.ok) return await r.text();
      console.warn('HTTP', r.status, u);
      if (r.status === 404) return null;
      if (r.status === 429) { const ra = +r.headers.get('retry-after') || 0; await sleep(Math.max(ra * 1000, 8000 * (i + 1))); continue; }
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
    const file = 'raw' + (p === '/' ? '/index' : p.replace('?page=', '__page_')) + '.html';
    if (process.env.SKIP_EXISTING) { try { await access(file); manifest.push({ path: p, file, ok: true }); continue; } catch {} }
    await sleep(700);
    const html = await get(p);
    if (!html) { manifest.push({ path: p, ok: false }); continue; }
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, strip(html));
    manifest.push({ path: p, file, ok: true });
    if (++n % 25 === 0) console.log(n, 'saved');
  }
}
await Promise.all(Array.from({ length: 2 }, worker));
manifest.sort((a, b) => a.path.localeCompare(b.path));
await writeFile('raw/manifest.json', JSON.stringify(manifest, null, 1));
console.log('done', manifest.filter(m => m.ok).length, '/', manifest.length);

// ---------- Wix build (new design reviewed by the client) ----------
const WIX = 'https://digitalpartnersasia.wixstudio.com/trinity';
const wixUrls = new Set([WIX, WIX + '/blog']);
const wixIndex = await get(WIX + '/sitemap.xml');
for (const sm of locs(wixIndex || '')) {
  const xml = sm.endsWith('.xml') ? await get(sm) : null;
  for (const u of xml ? locs(xml) : [sm]) if (u.includes('/trinity')) wixUrls.add(u);
}
// pick up any internal links from the homepage/menu too
const home = await get(WIX);
for (const m of (home || '').matchAll(/href="(https:\/\/digitalpartnersasia\.wixstudio\.(?:com|io)\/trinity[^"#?]*)"/g)) wixUrls.add(m[1].replace('.wixstudio.io', '.wixstudio.com'));
const wixManifest = [];
for (const u of wixUrls) {
  const path = u.replace(WIX, '') || '/';
  const file = 'raw-wix' + (path === '/' ? '/index' : path.replace(/\/$/, '')) + '.html';
  await sleep(400);
  const html = await get(u);
  if (!html) { wixManifest.push({ path, url: u, ok: false }); continue; }
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, html.replace(/<script\b(?![^>]*application\/(ld\+)?json)[\s\S]*?<\/script>/gi, '').replace(/<style\b[\s\S]*?<\/style>/gi, ''));
  wixManifest.push({ path, url: u, file, ok: true });
}
await mkdir('raw-wix', { recursive: true });
wixManifest.sort((a, b) => a.path.localeCompare(b.path));
await writeFile('raw-wix/manifest.json', JSON.stringify(wixManifest, null, 1));
console.log('wix done', wixManifest.filter(m => m.ok).length, '/', wixManifest.length);
