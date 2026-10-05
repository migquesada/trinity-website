// Convert raw/ Shopify snapshots into clean content JSON (content/).
// content/pages/<slug>.json  -> { path, title, description, template, hero, sections:[{type, html}] }
// content/posts.json         -> [{ path, title, date, image, tags, html, excerpt }]
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { parseHTML } from 'linkedom';

const manifest = JSON.parse(await readFile('raw/manifest.json', 'utf8')).filter(m => m.ok);

const KEEP_CLASS = /^(container|row|col-(xs|sm|md|lg)-\d+|col-\d+|col|page-head|tc|tl|tr|nt_section|type_[a-z0-9_]+)$/;
const KEEP_ATTR = { A: ['href', 'target'], IMG: ['src', 'alt'], TD: ['colspan', 'rowspan'], TH: ['colspan', 'rowspan'], IFRAME: ['src', 'height'], VIDEO: ['src', 'poster'], SOURCE: ['src', 'type'] };

const fixImg = src => {
  if (!src) return null;
  src = src.trim().split(' ')[0].replace('{width}', '1200').replace(/^\/\//, 'https://');
  if (src.startsWith('/cdn/')) src = 'https://trinity-insures.com' + src;
  if (src.startsWith('data:')) return null;
  // upgrade tiny placeholders (_1x1, _100x) to a usable size
  src = src.replace(/_(1x1|\d{1,3}x\d{0,3}|\d{1,3}x)\.(jpe?g|png|webp|gif)/i, '_1600x.$2');
  return src;
};
const fixHref = h => {
  if (!h) return h;
  h = h.replace(/^https?:\/\/(www\.)?trinity-insures\.com/, '');
  if (h === '') h = '/';
  if (h === '/account/' || h === '/account') h = '/pages/client-portal';
  return h;
};

function clean(root, document) {
  root.querySelectorAll('script,style,noscript,svg,link,meta,button,input,select,textarea,form,.globo-form,.social-share,.blog-navigation,.post-related,.nt-pagination,.products-footer,.lazyload-placeholder,.mb_img_slide,.grid-sizer').forEach(e => e.remove());
  root.querySelectorAll('*').forEach(el => {
    const st = el.getAttribute('style') || '';
    let bg = el.getAttribute('data-bgset') || el.getAttribute('data-bg') || '';
    if (bg) bg = bg.split(',').pop().trim().split(' ')[0];
    else { const m = st.match(/background-image:\s*url\(['"]?([^'")]+)/); if (m) bg = m[1]; }
    if (el.tagName === 'IMG') {
      const s = fixImg(el.getAttribute('data-src') || (el.getAttribute('data-srcset') || '').split(',').pop() || el.getAttribute('src'));
      if (!s) { el.remove(); return; }
      el.setAttribute('src', s);
    } else if (bg && fixImg(bg)) {
      el.setAttribute('data-keep-bg', fixImg(bg));
    }
    const pt = st.match(/padding-top:\s*([\d.]+%)/);
    const dr = parseFloat(el.getAttribute('data-ratio') || '');
    if (dr) el.setAttribute('data-keep-ratio', (100 / dr).toFixed(2) + '%');
    else if (pt) el.setAttribute('data-keep-ratio', pt[1]);
  });
  root.querySelectorAll('*').forEach(el => {
    const tag = el.tagName;
    const keepBg = el.getAttribute('data-keep-bg');
    const keepRatio = el.getAttribute('data-keep-ratio');
    const cls = (el.getAttribute('class') || '').split(/\s+/).filter(c => KEEP_CLASS.test(c));
    for (const at of [...el.attributes]) if (!(KEEP_ATTR[tag] || []).includes(at.name)) el.removeAttribute(at.name);
    if (cls.length) el.setAttribute('class', cls.join(' '));
    const style = [];
    if (keepBg) { style.push(`background-image:url('${keepBg}')`); el.setAttribute('class', ((el.getAttribute('class') || '') + ' bg').trim()); }
    if (keepRatio && keepBg) style.push(`padding-top:${keepRatio}`);
    if (style.length) el.setAttribute('style', style.join(';'));
    if (tag === 'A') { el.setAttribute('href', fixHref(el.getAttribute('href') || '')); if ((el.getAttribute('href') || '').startsWith('/')) el.removeAttribute('target'); if (!el.textContent.trim() && !el.querySelector('img,[data-keep-bg],.bg') && !el.getAttribute('class')) el.remove(); }
  });
  root.querySelectorAll('span,font,center,label,i:empty').forEach(el => el.replaceWith(...el.childNodes));
  // drop empty wrappers, collapse single-child div chains
  let changed = true;
  while (changed) {
    changed = false;
    for (const el of root.querySelectorAll('div,p')) {
      if (!el.parentNode) continue;
      const hasMedia = el.querySelector('img,iframe,video,hr,.bg') || (el.getAttribute('class') || '').includes('bg');
      if (!el.textContent.trim() && !hasMedia) { el.remove(); changed = true; continue; }
      if (el.tagName === 'DIV' && !el.getAttribute('class') && !el.getAttribute('style') && el.children.length === 1 &&
          ![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) { el.replaceWith(el.firstElementChild); changed = true; }
    }
  }
  return root.innerHTML.replace(/\s+/g, ' ').replace(/>\s+</g, '><').trim();
}

const slugOf = p => (p === '/' ? 'index' : p.replace(/^\//, '').replace(/[/?=]/g, '_'));
const pages = [], posts = [];

for (const m of manifest) {
  if (m.path.startsWith('/search') || m.path.startsWith('/account')) continue;
  const html = await readFile(m.file, 'utf8');
  const { document } = parseHTML(html);
  const title = (document.querySelector('title')?.textContent || '').replace(/\s*–\s*Trinity Insurance.*$/, '').trim();
  const description = document.querySelector('meta[name="description"]')?.getAttribute('content') || '';
  const ogImage = document.querySelector('meta[property="og:image"]')?.getAttribute('content') || '';
  const main = document.querySelector('#nt_content') || document.querySelector('main');
  if (!main) { console.warn('no main', m.path); continue; }

  // Blog article
  if (/^\/blogs\/[^/]+\/[^/?]+$/.test(m.path)) {
    const h1 = main.querySelector('h1')?.textContent.trim() || title;
    const date = main.querySelector('time')?.getAttribute('datetime') || main.querySelector('time')?.textContent.trim() || '';
    const tags = [...main.querySelectorAll('.post-tags a')].map(a => a.textContent.trim());
    const body = main.querySelector('.post-content') || main.querySelector('article');
    const img = main.querySelector('.entry-image img');
    const image = fixImg(img?.getAttribute('data-src') || img?.getAttribute('src')) || (ogImage ? fixImg(ogImage) : '');
    const bodyHtml = body ? clean(body, document) : '';
    const text = (body?.textContent || '').replace(/\s+/g, ' ').trim();
    posts.push({ path: m.path, blog: m.path.split('/')[2], title: h1, date, tags, image, description: description || text.slice(0, 160), excerpt: text.slice(0, 220), html: bodyHtml });
    continue;
  }
  // Blog listing pages are generated from posts
  if (/^\/blogs\/[^/]+(\?page=\d+)?$/.test(m.path)) continue;

  const sections = [];
  let hero = null;
  for (const s of [...main.children]) {
    if (!s.className || !String(s.className).includes('shopify-section')) continue;
    const type = (String(s.className).match(/type_[a-z0-9_]+/) || [''])[0] || (String(s.className).includes('heading') ? 'heading' : 'section');
    const head = s.querySelector('.page-head');
    if (!hero && (head || (!type.startsWith('type_') && s.querySelector('h1')))) {
      const h = head || s;
      const bgEl = h.querySelector('[data-bgset]') || h;
      const bgRaw = (bgEl.getAttribute('data-bgset') || '').split(',').pop().trim().split(' ')[0] || ((h.getAttribute('style') || '').match(/url\(['"]?([^'")]+)/) || [])[1];
      hero = { title: (h.querySelector('h1')?.textContent || '').trim(), image: fixImg(bgRaw) || null };
      continue;
    }
    const html = clean(s.cloneNode(true), document);
    if (!html || /^\s*$/.test(html.replace(/<[^>]+>/g, '').trim()) && !/<img|<iframe|class="[^"]*\bbg\b/.test(html)) continue;
    sections.push({ type, html: html.replace(/\{formbuilder:\d+\}/g, '<div data-form="inquiry"></div>') });
  }
  let template = 'page';
  if (m.path === '/') template = 'home';
  else if (m.path.startsWith('/products/')) template = 'product';
  // product pages: use product JSON-like data from the page
  if (template === 'product') {
    const pt = main.querySelector('.product_title, h1');
    const desc = main.querySelector('.pr_short_des, .product-single__description, .sp-tab-content, #tab_product_description');
    const img = main.querySelector('.product-images img, .p-thumb img, img');
    pages.push({ path: m.path, title, description, template, hero: null, product: {
      title: pt?.textContent.trim() || title,
      image: fixImg(img?.getAttribute('data-src') || img?.getAttribute('src')),
      html: desc ? clean(desc, document) : '' } , sections: [] });
    continue;
  }
  pages.push({ path: m.path, title, description, template, hero, sections });
}

const ts = d => { const t = Date.parse(String(d).replace(/ ([+-]\d{2})(\d{2})$/, '$1:$2').replace(' ', 'T')); return isNaN(t) ? 0 : t; };
posts.sort((a, b) => ts(b.date) - ts(a.date));
await mkdir('content/pages', { recursive: true });
for (const p of pages) await writeFile(`content/pages/${slugOf(p.path)}.json`, JSON.stringify(p, null, 1));
await writeFile('content/posts.json', JSON.stringify(posts, null, 1));
console.log('pages', pages.length, 'posts', posts.length);
