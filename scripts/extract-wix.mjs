// One-time: turn the Wix snapshot (raw-wix/) into structured content (content/v2/).
// Wix = the new design the client reviewed. Shopify content (content/pages, posts) fills in
// pages that were updated on Shopify after the Wix build (careers, privacy, governance docs, blogs).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { wixBlocks } from './wixblocks.mjs';

const WIX = 'https://digitalpartnersasia.wixstudio.com/trinity';
const man = JSON.parse(await readFile('raw-wix/manifest.json', 'utf8')).filter(m => m.ok && !m.path.endsWith('.xml'));
const blank = s => !s || /^[\s​]*$/.test(s);
const local = h => (h || '').replace(/^https:\/\/digitalpartnersasia\.wixstudio\.(com|io)\/trinity/, '') || '/';
const splitBullets = t => t.split(/\s*[•●▪]\s*/).map(s => s.trim()).filter(Boolean);
const imgFull = src => src; // static.wixstatic.com/media/<id> serves the original

function parseProduct(blocks) {
  const b = blocks.filter(x => !(x.t === 'p' && blank(x.text)));
  let i = 0;
  const out = { heroImage: null, title: '', intro: [], sections: [], why: [], cta: null };
  if (b[i]?.t === 'img') out.heroImage = imgFull(b[i++].src);
  while (b[i] && !/^h[1-6]$/.test(b[i].t)) i++;
  out.title = b[i]?.text || ''; i++;
  // intro paragraphs until first image / heading
  while (b[i] && b[i].t === 'p') out.intro.push(b[i++].text);
  // skip shop buttons
  while (b[i] && b[i].t === 'btn') i++;
  let cur = null;
  const push = () => { if (cur && (cur.title || cur.items.length || cur.paras.length)) out.sections.push(cur); cur = null; };
  for (; i < b.length; i++) {
    const x = b[i];
    if (x.t === 'form' || (x.t.startsWith('h') && /let.s talk/i.test(x.text))) break;
    if (x.t.startsWith('h') && /^why choose trinity/i.test(x.text)) { push(); break; }
    if (x.t === 'img') { push(); cur = { icon: imgFull(x.src), title: '', items: [], paras: [] }; continue; }
    if (x.t === 'btn') { (cur || (cur = { icon: null, title: '', items: [], paras: [] })).buttons = [...(cur.buttons || []), { text: x.text, href: x.href }]; continue; }
    if (!cur) cur = { icon: null, title: '', items: [], paras: [] };
    const t = x.text || '';
    if (/^h[1-6]$/.test(x.t) && !cur.title) { cur.title = t; continue; }
    if (x.t === 'li') { cur.items.push(t); continue; }
    if (t.includes('•') || t.includes('●')) {
      const parts = splitBullets(t);
      // "Why choose" style lines like "• KNOWLEDGE & EXPERTISE. Trinity has…" -> keep as items
      cur.items.push(...parts);
      continue;
    }
    if (!cur.title && t.length < 90 && (!/[.!]$/.test(t))) { cur.title = t; continue; }
    cur.paras.push(t);
  }
  push();
  // last section with no items and a "Don't wait…" paragraph is the CTA
  const last = out.sections[out.sections.length - 1];
  if (last && !last.items.length && last.paras.length && /don.t wait|inquire|secure|protect/i.test(last.paras.join(' '))) {
    out.cta = { icon: last.icon, text: last.paras.join(' ') };
    out.sections.pop();
  }
  // "Why choose Trinity?" section inside product body -> mark
  for (const s of out.sections) if (/why choose trinity/i.test(s.title)) s.kind = 'why';
  return out;
}

const pages = {};
for (const m of man) {
  const r = await wixBlocks(m.file);
  const path = m.path === '/' ? '/' : m.path;
  pages[path] = { path, title: r.title.replace(/\s*\|\s*Trinity$/, ''), description: r.description, blocks: r.blocks.filter(x => !(x.t === 'p' && blank(x.text))) };
}

const products = {};
for (const [path, p] of Object.entries(pages)) {
  const isProduct = /^\/solutions\/[^/]+\/[^/]+$/.test(path) || /^\/shop\/[^/]+$/.test(path);
  if (!isProduct) continue;
  products[path] = { path, category: path.split('/')[2] || 'shop', ...parseProduct(p.blocks), seoTitle: p.title, description: p.description };
}

// category pages: hero image + tagline + featured cards
const categories = {};
for (const cat of ['general-insurance', 'employee-benefits', 'service-solutions']) {
  const p = pages['/solutions/' + cat];
  if (!p) continue;
  const b = p.blocks;
  const hero = b.find(x => x.t === 'img')?.src || null;
  const hIdx = b.findIndex(x => /^h/.test(x.t));
  const featured = [];
  for (let i = 0; i < b.length; i++) {
    if (b[i].t === 'btn' && /learn more/i.test(b[i].text)) {
      const h = [...b.slice(0, i)].reverse().find(x => /^h/.test(x.t));
      const d = [...b.slice(0, i)].reverse().find(x => x.t === 'p');
      const img = [...b.slice(0, i)].reverse().find(x => x.t === 'img');
      featured.push({ title: h?.text, text: d?.text, href: local(b[i].href), image: img?.src });
    }
  }
  const list = b.filter(x => /^h/.test(x.t) && x.href && x.href.includes('/solutions/' + cat + '/')).map(x => ({ title: x.text, href: local(x.href) }));
  categories[cat] = { path: '/solutions/' + cat, title: b[hIdx]?.text, tagline: b[hIdx + 1]?.text, heroImage: hero, featured, list };
}

await mkdir('content/v2', { recursive: true });
await writeFile('content/v2/wix-pages.json', JSON.stringify(pages, null, 1));
await writeFile('content/v2/products.json', JSON.stringify(products, null, 1));
await writeFile('content/v2/categories.json', JSON.stringify(categories, null, 1));
console.log('wix pages', Object.keys(pages).length, 'products', Object.keys(products).length, 'categories', Object.keys(categories).length);
