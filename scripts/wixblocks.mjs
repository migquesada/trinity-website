// Linearize a Wix page into blocks: {t:'h1..h6'|'p'|'li'|'img'|'btn'|'video', ...}
import { readFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';
export async function wixBlocks(file) {
  const { document } = parseHTML(await readFile(file, 'utf8'));
  const root = document.querySelector('#PAGES_CONTAINER') || document.querySelector('main') || document.body;
  const out = [];
  const seenImg = new Set();
  const walk = el => {
    for (const c of el.children) {
      const tag = c.tagName;
      if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'svg'].includes(tag)) continue;
      if (/^H[1-6]$/.test(tag)) { const t = c.textContent.replace(/\s+/g, ' ').trim(); if (t) out.push({ t: tag.toLowerCase(), text: t, href: c.querySelector('a')?.getAttribute('href') || null }); continue; }
      if (tag === 'P') { const t = c.textContent.replace(/\s+/g, ' ').trim(); if (t) out.push({ t: 'p', text: t, html: c.innerHTML, href: c.querySelector('a')?.getAttribute('href') || null }); continue; }
      if (tag === 'LI') { const t = c.textContent.replace(/\s+/g, ' ').trim(); if (t) out.push({ t: 'li', text: t }); continue; }
      if (tag === 'IMG') {
        let src = c.getAttribute('src') || '';
        const m = src.match(/(https:\/\/static\.wixstatic\.com\/media\/[^/]+)/);
        if (m) src = m[1];
        const prev = out[out.length - 1];
        if (src && !src.startsWith('data:') && !(prev && prev.t === 'img' && prev.src === src)) out.push({ t: 'img', src, alt: c.getAttribute('alt') || '' });
        continue;
      }
      if (tag === 'VIDEO' || c.getAttribute('data-testid') === 'video-player') { out.push({ t: 'video', src: c.getAttribute('src') || '' }); }
      if (tag === 'A' && (c.getAttribute('data-testid') === 'linkElement' || c.className.includes('button') || c.getAttribute('aria-label')) && !c.querySelector('p,h1,h2,h3,h4,h5,h6,img')) {
        const t = c.textContent.replace(/\s+/g, ' ').trim(); if (t) { out.push({ t: 'btn', text: t, href: c.getAttribute('href') || null }); continue; }
      }
      if (tag === 'IFRAME') out.push({ t: 'iframe', src: c.getAttribute('src') || c.getAttribute('data-src') || '' });
      if (tag === 'FORM' || c.getAttribute('data-testid') === 'form') out.push({ t: 'form' });
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') { out.push({ t: 'field', name: c.getAttribute('aria-label') || c.getAttribute('placeholder') || c.getAttribute('name') || '' }); continue; }
      if (tag === 'LABEL') { const t = c.textContent.replace(/\s+/g, ' ').trim(); if (t) out.push({ t: 'label', text: t }); continue; }
      walk(c);
    }
  };
  walk(root);
  return { title: document.querySelector('title')?.textContent || '', description: document.querySelector('meta[name=description]')?.getAttribute('content') || '', blocks: out };
}
if (process.argv[2]) {
  const r = await wixBlocks(process.argv[2]);
  console.log(r.title); for (const b of r.blocks) console.log(b.t.padEnd(6), (b.text || b.src || b.name || '').slice(0, 140), b.href ? '→ ' + b.href : '');
}
