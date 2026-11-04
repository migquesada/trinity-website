// Trinity website v2 (Wix design, GitHub Pages + Supabase)
// content/v2/*  -> dist/
// IMG_MODE=download : download remote images/videos into dist/media (CI). Default: hotlink (local preview).
import { readFile, writeFile, mkdir, readdir, cp, rm, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { icon, productIcon } from './icons.mjs';
import { applyProductRevisions } from './revisions.mjs';
import { polish, readingTime } from './polish.mjs';
import { enhance, category } from './article.mjs';
import { parseHTML } from 'linkedom';

const OUT = 'dist';
const IMG_MODE = process.env.IMG_MODE || 'remote';
const site = JSON.parse(await readFile('content/site.json', 'utf8'));
const D = JSON.parse(await readFile('content/v2/site-data.json', 'utf8'));
const products = applyProductRevisions(JSON.parse(await readFile('content/v2/products.json', 'utf8')));
const categories = JSON.parse(await readFile('content/v2/categories.json', 'utf8'));
const wix = JSON.parse(await readFile('content/v2/wix-pages.json', 'utf8'));
const posts = JSON.parse(await readFile('content/posts.json', 'utf8'));
const shop = {};
for (const f of await readdir('content/pages')) if (f.endsWith('.json')) { const p = JSON.parse(await readFile(join('content/pages', f), 'utf8')); shop[p.path] = p; }
const ASSET_V = createHash('sha1').update((await readFile('assets/site.css', 'utf8')) + (await readFile('assets/site.js', 'utf8'))).digest('hex').slice(0, 8);
// Cloudflare Pages serves from the domain root; GitHub Pages serves from /trinity-website
const BASE = (process.env.BASE_PATH ?? (process.env.CF_PAGES ? '' : site.basePath) ?? '').replace(/\/$/, '');

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
await cp('assets', join(OUT, 'assets'), { recursive: true });

// ---------- helpers ----------
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const url = p => {
  if (!p || /^(https?:|mailto:|tel:|#|data:)/.test(p)) return p;
  if (BASE && (p === BASE || p.startsWith(BASE + '/'))) return p;
  return BASE + p;
};
const mediaMap = new Map();
const isRemote = u => /^https:\/\/(trinity-insures\.com\/cdn\/|cdn\.shopify\.com\/|static\.wixstatic\.com\/media\/|video\.wixstatic\.com\/)/.test(u || '');
function media(u) {
  if (!u) return u;
  if (IMG_MODE !== 'download' || !isRemote(u)) return u;
  if (!mediaMap.has(u)) {
    let name = u.split('?')[0].split('/').filter(Boolean);
    name = (u.includes('video.wixstatic.com') ? name.slice(-4, -3)[0] + '.mp4' : name.pop()).replace(/[^a-zA-Z0-9._~-]/g, '_');
    if (!/\.(jpe?g|png|gif|webp|svg|mp4|pdf|xlsx?|docx?)$/i.test(name)) name += '.jpg';
    mediaMap.set(u, `/media/${createHash('md5').update(u).digest('hex').slice(0, 6)}-${name}`);
  }
  return url(mediaMap.get(u));
}
// rewrite links/images inside legacy (Shopify) HTML
const OLD2NEW = {
  '/pages/about-us': '/about-us/corporate-profile', '/pages/meet-the-team': '/about-us/meet-the-team', '/pages/why-trinity': '/about-us/why-trinity',
  '/pages/industries-we-serve': '/about-us/industries-we-serve', '/pages/corporate-governance': '/about-us/corporate-governance',
  '/pages/general-insurance': '/solutions/general-insurance', '/pages/employee-benefits': '/solutions/employee-benefits', '/pages/service-solutions': '/solutions/service-solutions',
  '/pages/contact-us': '/contact-us', '/pages/claims': '/claims', '/pages/career': '/careers', '/pages/privacy-policy': '/privacy-policy',
  '/pages/terms-and-conditions': '/terms-and-conditions', '/pages/disclaimer': '/disclaimer', '/pages/cybersecurity': '/cybersecurity', '/pages/site-map': '/site-map',
  '/blogs/news': '/blog', '/products/bike-insurance': '/shop/bicycle-insurance', '/products/big-bike-insurance-inquiry-only': '/shop/big-bike-insurance',
  '/pages/travel-insurance-starr': '/shop/travel-insurance', '/pages/file-a-claim': '/claims', '/pages/payments': '/payments'
};
const mapPath = h => {
  if (!h) return h;
  const [p, q] = h.split('#');
  if (OLD2NEW[p]) return OLD2NEW[p] + (q ? '#' + q : '');
  const m = p.match(/^\/blogs\/news\/(.+)$/); if (m) return '/blog/' + m[1];
  const legacy = legacyProduct(p); if (legacy) return legacy + (q ? '#' + q : '');
  return h;
};
// Old Shopify product / collection links inside migrated articles → new product pages
function legacyProduct(p) {
  let d; try { d = decodeURIComponent(p); } catch { d = p; }
  d = d.replace(/[”"’].*$/, '').trim();
  if (/^\/collections\/products\/?$/.test(d)) return '/solutions';
  const cat = d.match(/^\/collections\/(general-insurance|employee-benefits|service-solutions)\/?$/); if (cat) return '/solutions/' + cat[1];
  const mm = d.match(/^\/(?:collections\/[^/]+\/products|products|pages)\/([^/?]+)\/?$/); if (!mm) return null;
  const norm = x => x.toLowerCase().replace(/motocar/, 'motorcar').replace(/-eei$/, '').replace(/^full-/, '').replace(/\b(and|insurance|product)\b/g, '').replace(/[^a-z]/g, '');
  const want = norm(mm[1]); if (!want) return null;
  const list = Object.values(products).filter(x => x.path.startsWith('/solutions/'));
  const hit = list.find(x => norm(x.path.split('/').pop()) === want) || list.find(x => { const n = norm(x.path.split('/').pop()); return n.startsWith(want) || want.startsWith(n); });
  return hit ? hit.path : null;
}
const rewrite = html => String(html || '')
  .replace(/(src|href)="([^"]+)"/g, (m, a, v) => {
    const d = v.replace(/&amp;/g, '&');
    if (a === 'src' || isRemote(d)) return `${a}="${esc(media(d))}"`;
    return `${a}="${esc(url(mapPath(d)))}"`;
  })
  .replace(/url\('([^']+)'\)/g, (m, v) => `url('${media(v.replace(/&amp;/g, '&'))}')`)
  .replace(/<img /g, '<img loading="lazy" ');
const img = (src, alt = '', cls = '') => src ? `<img src="${esc(media(src))}" alt="${esc(alt)}"${cls ? ` class="${cls}"` : ''} loading="lazy">` : '';
const btn = (text, href, cls = '') => `<a class="btn ${cls}" href="${esc(url(href))}"${/^https?:/.test(href) ? ' target="_blank" rel="noopener"' : ''}>${esc(text)}</a>`;
const fmtDate = d => { const t = new Date(String(d).replace(/ ([+-]\d{2})(\d{2})$/, '$1:$2').replace(' ', 'T')); return isNaN(t) ? d : t.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }); };
const sentenceCase = s => s && s === s.toUpperCase() ? s.toLowerCase().replace(/(^|[\s(/-])([a-z])/g, (m, a, b) => a + b.toUpperCase()).replace(/\b(And|Or|Of|The|For|In|To)\b/g, w => w.toLowerCase()).replace(/^./, c => c.toUpperCase()) : s;

// ---------- navigation ----------
const NAV = [
  { label: 'Home', href: '/' },
  { label: 'About Us', children: [
    { label: 'Corporate Profile', href: '/about-us/corporate-profile' },
    { label: 'Meet the Team', href: '/about-us/meet-the-team' },
    { label: 'Why Trinity', href: '/about-us/why-trinity' },
    { label: 'Industries We Serve', href: '/about-us/industries-we-serve' },
    { label: 'Corporate Governance', href: '/about-us/corporate-governance' }] },
  { label: 'Solutions', href: '/solutions', children: [
    { label: 'General Insurance', href: '/solutions/general-insurance' },
    { label: 'Employee Benefits', href: '/solutions/employee-benefits' },
    { label: 'Service Solutions', href: '/solutions/service-solutions' }] },
  { label: 'Shop', children: [
    { label: 'Bicycle Insurance', href: '/shop/bicycle-insurance' },
    { label: 'Big Bike Insurance', href: '/shop/big-bike-insurance' },
    { label: 'Travel Insurance', href: '/shop/travel-insurance' }] },
  { label: 'Blog', href: '/blog' },
  { label: 'Claims', href: '/claims' },
  { label: 'Careers', href: '/careers' },
  { label: 'Client Portal', href: '/client-portal' },
  { label: 'Contact Us', href: '/contact-us' }
];
const SOCIAL = [
  { label: 'Facebook', href: 'https://www.facebook.com/trinityinsures', icon: 'facebook' },
  { label: 'Instagram', href: 'https://www.instagram.com/trinityinsures/', icon: 'instagram' },
  { label: 'LinkedIn', href: 'https://www.linkedin.com/company/trinity-insurance-brokers-inc./', icon: 'linkedin' }
];
const isCur = (href, cur) => href === cur || (href !== '/' && cur.startsWith(href + '/'));
const navHtml = cur => NAV.map(it => it.children
  ? `<li class="has-sub${it.children.some(c => isCur(c.href, cur)) || (it.href && isCur(it.href, cur)) ? ' active' : ''}"><a href="${it.href ? url(it.href) : '#'}" class="nav-parent" aria-haspopup="true">${esc(it.label)}${icon('chevron', 'caret')}</a><ul class="sub">${it.children.map(c => `<li><a href="${url(c.href)}"${isCur(c.href, cur) ? ' aria-current="page"' : ''}>${esc(c.label)}</a></li>`).join('')}</ul></li>`
  : `<li${isCur(it.href, cur) && it.href !== '/' || (it.href === '/' && cur === '/') ? ' class="active"' : ''}><a href="${url(it.href)}">${esc(it.label)}</a></li>`).join('');

const gate = () => site.gate?.enabled ? `<meta name="robots" content="noindex,nofollow">
<style>html.locked body>*:not(#gate){display:none!important}#gate{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:#081f30;font-family:Poppins,system-ui,sans-serif}#gate form{background:#fff;padding:36px 32px;border-radius:14px;width:min(360px,90vw);text-align:center;box-shadow:0 10px 40px rgba(0,0,0,.3)}#gate img{height:52px;margin:0 auto 18px}#gate p{margin:0 0 16px;color:#555;font-size:14px}#gate input{width:100%;padding:12px;border:1px solid #ccc;border-radius:6px;font:inherit;margin-bottom:12px;box-sizing:border-box}#gate button{width:100%;padding:12px;border:0;border-radius:6px;background:#006a7b;color:#fff;font:600 14px Poppins,sans-serif;cursor:pointer}#gate .err{color:#c0392b;font-size:13px;min-height:18px;margin:8px 0 0}</style>
<script>(function(){var H="${site.gate.sha256}",K="trinity_gate";try{if(localStorage.getItem(K)===H)return}catch(e){}document.documentElement.classList.add("locked");document.addEventListener("DOMContentLoaded",function(){var d=document.createElement("div");d.id="gate";d.innerHTML='<form><img src="${esc(media(site.logo))}" alt="Trinity"><p>This preview site is password protected.</p><input type="password" placeholder="Password" autocomplete="current-password" required autofocus><button type="submit">Enter</button><p class="err" role="alert"></p></form>';document.body.appendChild(d);d.querySelector("form").addEventListener("submit",async function(e){e.preventDefault();var v=d.querySelector("input").value,b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v)),h=[].map.call(new Uint8Array(b),function(x){return x.toString(16).padStart(2,"0")}).join("");if(h===H){try{localStorage.setItem(K,H)}catch(e){}document.documentElement.classList.remove("locked");d.remove()}else{d.querySelector(".err").textContent="Incorrect password."}})})})();</script>` : '';

const ORG_ID = site.url + '/#organization';
const abs = u => !u ? null : /^https?:/.test(u) ? (isRemote(u) && IMG_MODE === 'download' ? site.url + media(u).replace(BASE, '') : u) : site.url + u.replace(BASE, '');
const ORG = {
  '@type': ['InsuranceAgency', 'Organization'], '@id': ORG_ID,
  name: 'Trinity Insurance Brokers', legalName: 'Trinity Insurance Brokers Inc.', alternateName: ['Trinity Insurance Brokers, Inc.', 'Trinity Insurance and Reinsurance Brokers, Inc.', 'TIRBI'],
  url: site.url + '/', logo: abs(site.logo), image: abs(site.logo), foundingDate: '1987',
  description: 'Full-line independent insurance broker in the Philippines providing general insurance, employee benefits and risk management solutions since 1987. Brokerslink partner with offices in Makati and Cebu.',
  email: site.email, telephone: site.phone, areaServed: { '@type': 'Country', name: 'Philippines' },
  address: { '@type': 'PostalAddress', streetAddress: '7504 Bagtikan St., San Antonio Village', addressLocality: 'Makati City', addressRegion: 'Metro Manila', postalCode: '1203', addressCountry: 'PH' },
  location: [
    { '@type': 'Place', name: 'Makati Head Office', address: { '@type': 'PostalAddress', streetAddress: '7504 Bagtikan St., San Antonio Village', addressLocality: 'Makati City', postalCode: '1203', addressCountry: 'PH' }, telephone: '+632 8810 1653' },
    { '@type': 'Place', name: 'Trinity Insurance Brokers Cebu', address: { '@type': 'PostalAddress', streetAddress: 'Unit 610 The Meridian by Avenir, Golam Drive, Brgy. Kasambagan', addressLocality: 'Cebu City', postalCode: '6000', addressCountry: 'PH' }, telephone: '+632 887 4002' }],
  openingHoursSpecification: { '@type': 'OpeningHoursSpecification', dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], opens: '08:30', closes: '17:30' },
  memberOf: [{ '@type': 'Organization', name: 'Brokerslink', url: 'https://www.brokerslink.com/' }],
  sameAs: ['https://www.facebook.com/trinityinsures', 'https://www.instagram.com/trinityinsures/', 'https://www.linkedin.com/company/trinity-insurance-brokers-inc./']
};
const crumbsFor = (path, title) => {
  if (path === '/' || path === '/404') return null;
  const parts = path.split('/').filter(Boolean); const items = [{ name: 'Home', item: site.url + '/' }];
  const label = { 'about-us': 'About Us', solutions: 'Solutions', shop: 'Shop', blog: 'Blog', 'general-insurance': 'General Insurance', 'employee-benefits': 'Employee Benefits', 'service-solutions': 'Service Solutions' };
  let acc = '';
  parts.forEach((seg, i) => { acc += '/' + seg; const last = i === parts.length - 1; items.push({ name: last ? title : (label[seg] || seg), item: site.url + acc }); });
  return { '@type': 'BreadcrumbList', itemListElement: items.map((x, i) => ({ '@type': 'ListItem', position: i + 1, name: x.name, item: x.item })) };
};
function layout({ path, title, description, image, body, bodyClass = '', schema = [], type = 'website', published = null, noindex = false }) {
  if (description) description = description.replace(/&nbsp;|&#160;|\u00a0/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, '’').replace(/\s+/g, ' ').trim();
  const full = path === '/' ? 'Trinity Insurance Brokers | General Insurance, Employee Benefits & Risk Management, Philippines' : `${title} | Trinity Insurance Brokers`;
  const canonical = site.url + (path === '/' ? '/' : path);
  return `<!doctype html>
<html lang="en-PH">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(full)}</title>
<meta name="description" content="${esc(description || site.footer.about)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:site_name" content="Trinity Insurance Brokers"><meta property="og:locale" content="en_PH"><meta property="og:title" content="${esc(full)}"><meta property="og:description" content="${esc(description || site.footer.about)}"><meta property="og:type" content="${type}"><meta property="og:url" content="${esc(canonical)}"><meta property="og:image" content="${esc(image ? abs(image) : site.url + '/assets/img/hero-40-team.jpg')}">${published ? `<meta property="article:published_time" content="${esc(published)}">` : ''}
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(full)}"><meta name="twitter:description" content="${esc(description || site.footer.about)}"><meta name="twitter:image" content="${esc(image ? abs(image) : site.url + '/assets/img/hero-40-team.jpg')}">
<meta name="theme-color" content="#081f30">
${IMG_MODE === 'download' ? `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' data:; media-src 'self'; font-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self' ${site.supabase.url}; form-action 'self'; base-uri 'self'; object-src 'none'">
<meta name="referrer" content="strict-origin-when-cross-origin">` : ''}
<link rel="preload" href="${url('/assets/fonts/poppins-latin-400-normal.woff2')}" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${url('/assets/site.css')}?v=${ASSET_V}">
<link rel="icon" href="${url('/assets/favicon.png')}">
<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': [
  ORG,
  { '@type': 'WebSite', '@id': site.url + '/#website', url: site.url + '/', name: 'Trinity Insurance Brokers', publisher: { '@id': ORG_ID }, inLanguage: 'en-PH', potentialAction: { '@type': 'SearchAction', target: site.url + '/search?q={q}', 'query-input': 'required name=q' } },
  { '@type': type === 'article' ? 'WebPage' : 'WebPage', '@id': canonical + '#webpage', url: canonical, name: full, description: description || site.footer.about, isPartOf: { '@id': site.url + '/#website' }, about: { '@id': ORG_ID }, inLanguage: 'en-PH' },
  ...[crumbsFor(path, title)].filter(Boolean), ...schema
] }).replace(/</g, '\\u003c')}</script>
<script>window.SITE=${JSON.stringify({ base: BASE, supabase: site.supabase, prodHost: site.forms.productionHost })};</script>
${gate()}${noindex && !site.gate?.enabled ? '<meta name="robots" content="noindex,nofollow">' : ''}
</head>
<body class="${bodyClass}">
<a class="skip" href="#main">Skip to content</a>
<header class="site-header">
  <div class="wrap header-row">
    <a class="logo" href="${url('/')}"><img src="${esc(media(site.logo))}" alt="${esc(site.name)}" width="220" height="62"></a>
    <button class="menu-toggle" aria-label="Open menu" aria-expanded="false">${icon('menu')}</button>
    <nav class="main-nav" aria-label="Main"><ul>${navHtml(path)}</ul></nav>
  </div>
</header>
<main id="main">
${body}
</main>
<footer class="site-footer">
  <div class="wrap footer-grid">
    <div class="f-about"><a href="${url('/')}"><img src="${esc(media(site.logoInverse))}" alt="${esc(site.name)}" width="220"></a><p>${esc(site.footer.about)}</p></div>
    <div><h3>Useful Links</h3><ul>
      <li><a href="${url('/privacy-policy')}">Privacy Policy</a></li><li><a href="${url('/terms-and-conditions')}">Terms &amp; Conditions</a></li>
      <li><a href="${url('/disclaimer')}">Disclaimer</a></li><li><a href="${url('/cybersecurity')}">Cybersecurity</a></li>
      <li><a href="${esc(media(site.footer.legal.find(l => /conduct/i.test(l.label)).href))}" target="_blank" rel="noopener">Code of Conduct</a></li></ul></div>
    <div><h3>Browse</h3><ul>
      <li><a href="${url('/solutions')}">Solutions</a></li><li><a href="${url('/blog')}">Blogs</a></li><li><a href="${url('/careers')}">Careers</a></li>
      <li><a href="${url('/client-portal')}">Client Portal</a></li><li><a href="${url('/contact-us')}">Contact Us</a></li><li><a href="${url('/site-map')}">Site Map</a></li></ul></div>
    <div class="f-social"><h3>Follow Us</h3><div class="social">${SOCIAL.map(s => `<a href="${s.href}" target="_blank" rel="noopener" aria-label="${s.label}">${icon(s.icon)}</a>`).join('')}</div>
      <p class="f-contact">${esc(site.phone)}<br><a href="mailto:${site.email}">${site.email}</a></p></div>
  </div>
  <div class="credentials">In business since 1987 · Licensed by the Insurance Commission · Brokerslink partner · Offices in Makati and Cebu</div>
  <div class="copyright">© ${new Date().getFullYear()} by ${esc(site.name)}</div>
</footer>
<a href="#" class="to-top" aria-label="Back to top">${icon('up')}</a>
<script src="${url('/assets/site.js')}?v=${ASSET_V}" defer></script>
</body>
</html>`;
}

async function emit(path, html) {
  const file = path === '/' ? join(OUT, 'index.html') : join(OUT, path.replace(/^\//, ''), 'index.html');
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, html);
}
const all = [];
const searchIndex = [];
async function page(path, title, body, opts = {}) {
  await emit(path, layout({ path, title, body, ...opts }));
  if (opts.noindex) return;
  all.push(path);
  searchIndex.push({ t: title, u: path, d: (opts.description || '').slice(0, 160) });
}

// ---------- shared sections ----------
const pageHero = (title, text = '', image = null, buttons = '') => `<section class="page-hero${image ? ' has-img' : ''}"${image ? ` style="--hero:url('${media(image)}')"` : ''}><div class="wrap"><h1>${esc(title)}</h1>${text ? `<p>${esc(text)}</p>` : ''}${buttons ? `<div class="btns">${buttons}</div>` : ''}</div></section>`;
const quickAccess = () => `<section class="quick"><div class="wrap"><h2>Quick Access Portal</h2><div class="quick-grid">${D.home.quickAccess.map(q => `<a class="quick-item" href="${url(q.href)}">${icon({ '/solutions': 'pesohand', '/claims': 'claim', '/careers': 'usercheck' }[q.href] || 'shield', 'qa-ic')}<span>${esc(q.label)}</span></a>`).join('')}</div></div></section>`;
const statsPartners = (heading = 'Our International Network Partners') => `<section class="trust"><div class="wrap"><h2>Trust &amp; Legacy</h2><div class="stats">${D.stats.map(s => `<div><strong>${esc(s.value)}</strong><span>${esc(s.label)}</span></div>`).join('')}</div><hr><h2>${esc(heading)}</h2><div class="partners">${D.partners.map(p => `<figure>${img(p.logo, p.name)}<figcaption>${esc(p.name)}</figcaption></figure>`).join('')}</div></div></section>`;
const whyChoose = () => `<section class="why"><div class="wrap"><h2>Why Choose Trinity?</h2><div class="why-grid">${D.why.map(w => `<div class="why-item">${img(w.icon, '')}<h3>${esc(w.title)}</h3><p>${esc(w.text)}</p></div>`).join('')}</div></div></section>`;
const ctaBand = () => `<section class="cta-band" style="--cta:url('${media(D.ctaImage)}')"><div class="wrap"><h2>We protect what matters most to you.</h2><p>Let's build a safer and more secure future together.</p><div class="btns">${btn('Get a Quote', '/contact-us', 'btn-orange')}${btn('Talk to Us', '/contact-us', 'btn-light')}</div></div></section>`;
const formSection = (kind, title = "Let's Talk", text = "Have questions or need expert guidance? Connect with our team today and let's find the right insurance solutions for your needs. We'll get back to you shortly.", subject = '') => `<section class="form-sec" id="inquire"><div class="wrap narrow"><h2>${esc(title)}</h2><p>${esc(text)}</p><div data-form="${kind}" data-subject="${esc(subject)}"></div></div></section>`;
const postCard = a => { const u = url('/blog/' + a.path.split('/').pop()); const ex = (a.excerpt || a.description || '').replace(/\s+/g, ' ').trim(); const cat = category(a); return `<article class="post-card" data-cat="${esc(cat)}" data-title="${esc((a.title + ' ' + (a.tags || []).join(' ') + ' ' + cat).toLowerCase())}"><a href="${u}" class="thumb"${a.image ? ` style="background-image:url('${media(a.image)}')"` : ''} aria-label="${esc(a.title)}"></a><div class="post-info"><p class="kicker">${esc(category(a))}</p><p class="post-meta">${a.date ? `<time>${esc(fmtDate(a.date))}</time>` : ''}${a.html && readingTime(a.html) ? `<span>${readingTime(a.html)} min read</span>` : ''}</p><h3><a href="${u}">${esc(a.title)}</a></h3>${ex && ex.length > 40 ? `<p class="excerpt">${esc(ex.slice(0, 150))}${ex.length > 150 ? '…' : ''}</p>` : ''}<a class="more-link" href="${u}">Read article ${icon('arrow', 'ic')}</a></div></article>`; };
const articleCards = list => `<div class="post-grid">${list.map(postCard).join('')}</div>`;

const steps = (list, cls = '') => `<ol class="process${cls ? ' ' + cls : ''}">${list.map(x => `<li>${x.icon ? `<span class="pr-ic">${icon(x.icon, 'ic')}</span>` : ''}<h3>${esc(x.t)}</h3><p>${esc(x.d)}</p></li>`).join('')}</ol>`;
const tocBox = (toc, title = 'On this page') => toc.length >= 3 ? `<nav class="toc" aria-label="${esc(title)}"><p class="toc-title">${esc(title)}</p><ol>${toc.map(t => `<li><a href="#${t.id}">${esc(t.t)}</a></li>`).join('')}</ol></nav>` : '';
const pickToc = toc => toc.some(t => t.n) ? toc.filter(t => t.n) : toc;


// ---------- product spotlight (featured on the current site: Cybercrime, Poultry & Livestock) ----------
const SPOT = [
  { path: '/solutions/general-insurance/cybercrime-insurance', icon: 'cyber', tag: 'Protect your data and operations' },
  { path: '/solutions/general-insurance/poultry-and-livestock-insurance', icon: 'livestock', tag: 'Protect your farm and herd' }
];
const ptitle = p => (categories[p.category]?.list.find(x => x.href === p.path)?.title) || sentenceCase(p.title);
const POPULAR = { // as listed on the current homepage
  'general-insurance': ['cybercrime-insurance', 'poultry-and-livestock-insurance', 'marinecargo-hull-aviation-insurance', 'motorcar-insurance'],
  'employee-benefits': ['hmo', 'international-medical-insurance', 'amwa-insurance', 'critical-illness'],
  'service-solutions': ['third-party-administration', 'claims-management', 'industry-benchmarking', 'wellness-program-development-management']
};
const popularLinks = cat => { const list = (POPULAR[cat] || []).map(sl => Object.values(products).find(p => p.path.endsWith('/' + sl))).filter(Boolean); return list.length ? `<ul class="popular">${list.map(p => `<li><a href="${url(p.path)}">${productIcon(p.path)}<span>${esc(ptitle(p))}</span></a></li>`).join('')}</ul>` : ''; };
const spotlight = (heading = 'In the spotlight', sub = 'Specialized protection for risks many businesses overlook.') => {
  const cards = SPOT.map(sp => { const p = Object.values(products).find(x => x.path === sp.path); if (!p) return ''; const intro = p.intro.filter(t => t.trim()).join(' '); const first = (intro.match(/[^.!?]+[.!?]+/g) || [intro]).slice(0, 2).join(' ').trim(); const cov = (p.sections.find(x => /coverage/i.test(x.title || '') && x.items.length) || p.sections[0]); const items = (cov?.items || []).filter(t => !/^note/i.test(t)).slice(0, 4);
    return `<article class="spot-card"><a class="spot-img" href="${url(p.path)}" style="--img:url('${media(p.heroImage)}')" aria-label="${esc(ptitle(p))}"><span class="spot-ic">${icon(sp.icon, 'ic')}</span></a><div class="spot-body"><p class="kicker">General Insurance</p><h3><a href="${url(p.path)}">${esc(ptitle(p))}</a></h3><p>${esc(first)}</p>${items.length ? `<ul class="ticks">${items.map(t => `<li>${esc(t.replace(/\s+o\s+/g, ', '))}</li>`).join('')}</ul>` : ''}<div class="btns">${btn('Learn More', p.path, 'btn-sm')}${btn('Get a Quote', p.path + '#inquire', 'btn-sm btn-orange')}</div></div></article>`; }).join('');
  return `<section class="sec spotlight"><div class="wrap"><p class="eyebrow-lg tc">Featured coverage</p><h2>${esc(heading)}</h2><p class="lead tc">${esc(sub)}</p><div class="spot-grid">${cards}</div></div></section>`;
};

// ---------- HOME ----------
{
  const H = D.home;
  const body = `
<section class="home-hero v40"><h1 class="sr-only">Trinity Insurance Brokers – ${esc(H.heroTitle[0])} ${esc(H.heroTitle[1])}</h1><picture><source type="image/webp" srcset="${url('/assets/img/hero-40-team-1000.webp')} 1000w, ${url('/assets/img/hero-40-team.webp')} 2240w" sizes="100vw"><img class="hero40" src="${url('/assets/img/hero-40-team.jpg')}" width="2240" height="960" alt="Trinity Insurance Brokers – 40 years, Ever eager to serve you. Trinity is your trusted partner in providing world-class insurance programs and risk management solutions. Filipino professionals from different industries – office, construction, healthcare and field work – with the Makati and Cebu skylines." fetchpriority="high"></picture></section>
<section class="hero-strip"><div class="wrap hs-row"><div><p class="hs-title">${esc(H.heroTitle[0])} <span>${esc(H.heroTitle[1])}</span></p><p>${esc(H.heroText)}</p></div><div class="btns">${btn('Get a Quote', '/contact-us', 'btn-orange')}${btn('Our Solutions', '/solutions')}</div></div></section>
${quickAccess()}
<section class="solutions-bento"><div class="wrap"><h2>Trinity Insurance Solutions</h2>
  <div class="bento">
    <a class="bento-big" href="${url(H.bento[0].href)}" style="--bg:url('${media(H.bento[0].image)}')"><h3>${esc(H.bento[0].title)}</h3><p>${esc(H.bento[0].text)}</p><div class="bento-imgs single">${img(H.bento[0].images[0], 'Cargo vessel at sea – corporate risk and marine insurance')}</div></a>
    ${H.bento.slice(1).map(b => `<a class="bento-card" href="${url(b.href)}"><div><h3>${esc(b.title)}</h3><p>${esc(b.text)}</p></div>${img(b.image, '')}</a>`).join('')}
  </div>
  <div class="tiles">${H.tiles.map(t => `<a class="tile" href="${url(t.href)}" style="--bg:url('${media(t.image)}')"><span>${esc(t.title)}</span></a>`).join('')}</div>
</div></section>
<section class="featured"><div class="wrap"><h2>Featured Solutions</h2><div class="card-grid three">${H.featured.map(f => `<article class="card">${img(f.image, f.title)}<div class="card-body"><h3>${esc(f.title)}</h3><p>${esc(f.text)}</p>${popularLinks(f.href.split('/').pop())}${btn('View all', f.href, 'btn-sm')}</div></article>`).join('')}</div></div></section>
${spotlight()}
${statsPartners()}
<section class="articles"><div class="wrap"><h2>Latest Articles</h2>${articleCards(posts.filter(p => p.blog === 'news').slice(0, 3))}<p class="tc">${btn('Explore Articles', '/blog')}</p></div></section>
<section class="promise"><div class="wrap"><h2>The Trinity Promise</h2><div class="promise-grid">${img(H.promiseImage, 'Trinity team meeting with a client', 'promise-img')}<div><h3>Our Story</h3><blockquote>“${esc(H.promiseQuote)}”</blockquote><p>${esc(site.footer.about)}</p></div></div></div></section>`;
  await page('/', 'Home', body, { description: 'Trinity Insurance Brokers Inc. – your partner in growing your business for 40 years: general insurance, employee benefits, and risk management solutions.', bodyClass: 'tpl-home' });
}

// ---------- CORPORATE PROFILE ----------
{
  const w = wix['/about-us/corporate-profile'].blocks;
  const ci = w.findIndex(b => /chairman/i.test(b.text || ''));
  const msg = []; for (let i = ci + 1; i < w.length && w[i].t === 'p'; i++) msg.push(w[i].text);
  const hi = w.findIndex(b => /evolving with history/i.test(b.text || ''));
  const hist = []; for (let i = hi + 1; i < w.length && w[i].t === 'p'; i++) hist.push(w[i].text);
  const sign = msg.splice(msg.findIndex(t => /very truly/i.test(t)));
  const body = pageHero('Corporate Profile') + `
<section class="chairman"><div class="wrap split"><div><h2>Chairman's Message</h2>${msg.map(t => `<p>${esc(t)}</p>`).join('')}<p class="sign">${esc(sign[0] || '')}<br><strong>${esc(sign[1] || 'Isidro G. Garcia')}</strong><br>${esc(sign[2] || 'Chairman and President')}</p></div><div>${img(D.chairman.image, 'Isidro G. Garcia, Chairman and President', 'rounded')}</div></div></section>
<section class="videos"><div class="wrap"><div class="video-grid">${D.chairman.videos.map((v, i) => `<button class="video-thumb" data-video="${esc(media(v.src))}" style="background-image:url('${media(v.poster)}')" aria-label="Play video ${i + 1}">${icon('play', 'play')}</button>`).join('')}</div><p class="muted tc">Click a video to play it with sound.</p></div></section>
<section class="history"><div class="wrap split reverse">${img(D.chairman.historyImage, 'The Trinity team', 'rounded')}<div><h2>Evolving with History</h2>${hist.map(t => `<p>${esc(t.replace('buisinestes', 'businesses').replace('clerity', 'clarity'))}</p>`).join('')}</div></div></section>
<section class="milestones"><div class="wrap"><h2>Milestones</h2><ol class="timeline">${D.milestones.map(m => `<li><span class="yr">${esc(m.year)}</span><h3>${esc(m.title)}</h3><p>${esc(m.text)}</p></li>`).join('')}</ol></div></section>
<section class="values"><div class="wrap"><h2>Our Core Values</h2><p class="lead tc">Guided by principles of Excellence, Integrity, Passion, and Courage, Trinity is committed to delivering not just solutions but lasting value.</p><div class="card-grid four">${D.values.map(v => `<div class="value-card">${icon(v.icon, 'value-icon')}<h3>${esc(v.title)}</h3><p>${esc(v.text)}</p></div>`).join('')}</div></div></section>`;
  await page('/about-us/corporate-profile', 'Corporate Profile', body, { description: 'Trinity Insurance Brokers Inc. – chairman\'s message, history, milestones and core values.' });
}

// ---------- MEET THE TEAM ----------
{
  const person = p => `<article class="person">${p.photo ? img(p.photo, p.name) : `<div class="photo-ph" aria-hidden="true">${esc(p.name.split(' ').filter(w => /^[A-Z]/.test(w)).map(w => w[0]).slice(0, 2).join(''))}</div>`}<h3>${esc(p.name)}</h3><p class="role">${esc(p.role)}</p>${(p.creds || []).map(c => `<p class="cred">${esc(c)}</p>`).join('')}</article>`;
  const body = pageHero('Meet the Team') + `
<section class="team"><div class="wrap"><h2>Board of Directors</h2><div class="people">${D.board.map(person).join('')}</div></div></section>
<section class="leader-intro"><div class="wrap split">${img(D.home.promiseImage, 'Trinity leadership', 'rounded')}<div><h2>Our Leadership</h2><blockquote>“Guiding Trinity with decades of experience, innovation, and integrity.”</blockquote><p>Our leadership team drives our mission to deliver personalized, world-class risk management solutions.</p></div></div></section>
<section class="team"><div class="wrap"><h2>Leadership Team</h2><div class="people">${D.leadership.map(person).join('')}</div></div></section>`;
  await page('/about-us/meet-the-team', 'Meet the Team', body, { description: 'Board of Directors and Leadership Team of Trinity Insurance Brokers Inc.', schema: [...D.board, ...D.leadership].map(x => ({ '@type': 'Person', name: x.name.replace(/^Atty\. /, ''), honorificPrefix: /^Atty\./.test(x.name) ? 'Atty.' : undefined, jobTitle: x.role, worksFor: { '@id': ORG_ID }, image: x.photo ? abs(x.photo) : undefined, description: (x.creds || []).join('; ') || undefined })) });
}

// ---------- WHY TRINITY ----------
{
  const w = wix['/about-us/why-trinity'].blocks;
  const adv = [];
  const ai = w.findIndex(b => /trinity advantage/i.test(b.text || ''));
  // Wix pairs are offset by one (description sits above the next heading) – use the Shopify copy, which is correct.
  const sh = shop['/pages/why-trinity'];
  const shHtml = sh ? sh.sections.map(s => s.html).join('') : '';
  const re = /<h3[^>]*>(.*?)<\/h3>\s*(?:<[^h][^>]*>)*\s*<p>(.*?)<\/p>/g; let m;
  while ((m = re.exec(shHtml))) if (!/core values|why trinity|partners/i.test(m[1])) adv.push({ t: m[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&'), d: m[2].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&nbsp;|&#160;/g, ' ') });
  const icons = ['knowledge', 'focus', 'cost', 'peace', 'personalized', 'global'];
  const body = pageHero('Why Trinity', 'Protection backed by expertise, driven by trust.', w.find(b => b.t === 'img')?.src, btn('Get a Quote', '/contact-us') + btn('Our Solutions', '/solutions', 'btn-orange')) + quickAccess() + `
<section class="intro"><div class="wrap split"><div><h2>A Partner in Risk Management</h2><p>${esc(w.find(b => /we help businesses/i.test(b.text || ''))?.text || '')}</p></div>${img(w.find((b, i) => b.t === 'img' && i > 5)?.src, '', 'rounded')}</div></section>
<section class="advantage"><div class="wrap"><h2>The Trinity Advantage</h2><p class="lead tc">Decades of experience delivering trusted insurance and risk advisory solutions.</p><div class="card-grid three">${adv.slice(0, 6).map((a, i) => `<div class="adv-card">${icon(icons[i] || 'shield', 'adv-icon')}<h3>${esc(a.t)}</h3><p>${esc(a.d)}</p></div>`).join('')}</div></div></section>
${statsPartners()}`;
  await page('/about-us/why-trinity', 'Why Trinity', body, { description: 'Why companies choose Trinity Insurance Brokers: expertise, business focus, cost efficiency, peace of mind, personalized service and global reach.' });
}

// ---------- INDUSTRIES ----------
{
  const w = wix['/about-us/industries-we-serve'].blocks;
  const ii = w.findIndex(b => b.t.startsWith('h') && /^industries we serve$/i.test(b.text) ) ;
  const start = w.findIndex((b, i) => i > ii + 3 && b.t.startsWith('h') && /^industries we serve$/i.test(b.text));
  const cards = [];
  for (let i = start + 1; i < w.length; i++) {
    if (w[i].t.startsWith('h') && /full-service brokerage/i.test(w[i].text)) break;
    if (w[i].t === 'img' && w[i + 1]?.t.startsWith('h')) cards.push({ img: w[i].src, t: sentenceCase(w[i + 1].text).replace('AviatioN', 'Aviation'), d: w[i + 2]?.t === 'p' ? w[i + 2].text.replace('Socialized', 'Specialized').replace('risk. solution', 'risk solutions') : '' });
  }
  const listBlocks = w.slice(w.findIndex(b => /full-service brokerage/i.test(b.text || '')) + 1).filter(b => b.t === 'p' && b.text.includes('•'));
  const list = listBlocks.flatMap(b => b.text.split('•').map(s => s.trim()).filter(Boolean));
  const body = pageHero('Industries We Serve', 'Protection tailored for every sector.', w.find(b => b.t === 'img')?.src, btn('Get a Quote', '/contact-us') + btn('Our Solutions', '/solutions', 'btn-orange')) + quickAccess() + `
<section class="intro"><div class="wrap narrow tc"><h2>Supporting Every Industry</h2><p class="lead">${esc(w.find(b => /we partner with organizations/i.test(b.text || ''))?.text || '')}</p></div></section>
<section class="industries"><div class="wrap"><div class="card-grid four">${cards.map(c => `<article class="ind-card">${img(c.img, c.t)}<div><h3>${esc(c.t)}</h3><p>${esc(c.d)}</p></div></article>`).join('')}</div></div></section>
<section class="ind-list"><div class="wrap"><h2>As a full-service brokerage firm, we serve a wide range of industries</h2><ul class="cols ticks">${list.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div></section>
${statsPartners()}`;
  await page('/about-us/industries-we-serve', 'Industries We Serve', body, { description: 'Industries served by Trinity Insurance Brokers – automotive, aviation, construction, healthcare, logistics, real estate, retail, IT and more.' });
}

// ---------- CORPORATE GOVERNANCE (documents from the live site, restructured) ----------
{
  const sh = shop['/pages/corporate-governance'];
  const { document } = parseHTML(`<div id="r">${sh.sections.map(s => s.html).join('')}</div>`);
  const groups = []; let intro = [];
  const nice = t => {
    t = t.replace(/\s+/g, ' ').trim().replace(/ESCALER ESCALER/i, 'ESCALER');
    if (t === t.toUpperCase() && /[A-Z]{3}/.test(t) && !/\b(GIS|ACGS|ACGR|AMLC|RPT|BOD|IAD|OSH)\b/.test(t)) t = t.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());
    return t.replace(/\bSec Cert\b/, 'Secretary’s Certificate');
  };
  const kind = h => /\.xlsx?(\?|$)/i.test(h) ? ['sheet', 'Excel'] : /\.(jpe?g|png|webp)(\?|$)/i.test(h) ? ['image', 'Image'] : ['doc', 'PDF'];
  let refs = [];
  for (const el of document.querySelectorAll('#r p, #r h3')) {
    const a = el.querySelector('a'), t = el.textContent.replace(/\s+/g, ' ').trim();
    if (el.tagName === 'P') {
      if (/^Reference/i.test(t)) { refs = [...el.querySelectorAll('a')].map(x => x.textContent.trim()); continue; }
      if (t) intro.push(t); continue;
    }
    if (!a || /\btc\b/.test(el.className)) {
      const y = t.match(/^(\d{4})$/), tr = t.match(/training\s+(\d{4})/i);
      groups.push({ title: tr ? `Corporate Governance Training ${tr[1]}` : y ? `${y[1]} Reports, Policies & Corporate Documents` : t, note: tr ? 'Certificates of completion of the annual corporate governance training of our directors and officers.' : '', intro: intro.splice(0), docs: [], training: !!tr });
      continue;
    }
    if (!groups.length) groups.push({ title: 'Annual Corporate Governance Scorecards (ACGS)', intro: intro.splice(0), docs: [] });
    if (intro.length && groups.at(-1).docs.length) { groups.push({ title: 'Annual Corporate Governance Reports (ACGR)', intro: intro.splice(0), docs: [] }); }
    groups.at(-1).docs.push({ t: nice(t), href: a.getAttribute('href') });
  }
  // the ACGR circular paragraph introduces the yearly groups that follow it
  const g = groups.filter(x => x.docs.length);
  g.forEach(x => { if (x.title.startsWith('Annual Corporate Governance Reports') && !x.docs.length) x.skip = true; });
  const idOf = t => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const card = d => { const [ic, lab] = kind(d.href); return `<a class="doc-card" href="${esc(media(d.href))}" target="_blank" rel="noopener"><span class="doc-ic">${icon(ic, 'ic')}</span><span class="doc-t"><strong>${esc(d.t)}</strong><small>${lab} · Opens in a new tab</small></span>${icon('download', 'ic doc-dl')}</a>`; };
  const pillars = [
    { icon: 'book', t: 'Transparency', d: 'Our governance reports, policies and disclosures are published here as required by the Insurance Commission.' },
    { icon: 'usercheck', t: 'Accountability', d: 'Our directors and officers undergo corporate governance training. Their certificates are published below.' },
    { icon: 'shield', t: 'Integrity', d: 'Concerns can be raised in confidence through our whistleblowing channel, protected by our non-retaliation policy.' }
  ];
  const body = pageHero('Corporate Governance', 'Transparency, accountability and integrity.') + `
<section class="sec gov-intro"><div class="wrap"><div class="card-grid three">${pillars.map(p => `<div class="adv-card">${icon(p.icon, 'adv-icon')}<h3>${esc(p.t)}</h3><p>${esc(p.d)}</p></div>`).join('')}</div>
${refs.length ? `<p class="refs">${icon('info', 'ic')} Regulatory references: ${refs.map(r => `<a href="https://${esc(r.replace(/^https?:\/\//, ''))}" target="_blank" rel="noopener">${esc(r)}</a>`).join(' · ')}</p>` : ''}
<nav class="chips" aria-label="Document groups">${g.map(x => `<a href="#${idOf(x.title)}">${esc(x.title)}</a>`).join('')}<a href="#inquire">Whistleblowing</a></nav></div></section>
${g.map((x, i) => `<section class="sec doc-group${i % 2 ? ' alt' : ''}" id="${idOf(x.title)}"><div class="wrap"><div class="sec-head"><span class="sec-num">${String(i + 1).padStart(2, '0')}</span><div><h2>${esc(x.title)}</h2>${[...x.intro, x.note].filter(Boolean).map(t => `<p>${esc(t)}</p>`).join('')}</div></div><div class="doc-grid">${x.docs.map(card).join('')}</div></div></section>`).join('')}
${formSection('whistleblowing', 'Have concerns or want to report an issue?', 'Help us uphold transparency and integrity. All reports are treated with strict confidentiality. You may submit anonymously.')}`;
  await page('/about-us/corporate-governance', 'Corporate Governance', body, { description: 'Corporate governance documents, scorecards, annual reports, training certificates and whistleblowing channel of Trinity Insurance Brokers Inc.' });
}

// ---------- SOLUTIONS ----------
const CAT_META = {
  'general-insurance': { title: 'General Insurance', tagline: 'Comprehensive protection for your business, assets, and the people who matter most.' },
  'employee-benefits': { title: 'Employee Benefits', tagline: 'Flexible, high-value coverage that keeps your people healthy and your business productive.' },
  'service-solutions': { title: 'Service Solutions', tagline: 'Expert advisory and administration services that help you manage risk with confidence.' }
};
const productList = cat => Object.values(products).filter(p => p.path.startsWith('/solutions/' + cat + '/'))
  .sort((a, b) => categories[cat].list.findIndex(x => x.href === a.path) - categories[cat].list.findIndex(x => x.href === b.path));
const prodTitle = p => (categories[p.category]?.list.find(x => x.href === p.path)?.title) || sentenceCase(p.title);
const productGrid = cat => `<ul class="prod-grid">${productList(cat).map(p => `<li><a href="${url(p.path)}">${productIcon(p.path)}<span>${esc(prodTitle(p))}</span></a></li>`).join('')}</ul>`;
{
  const body = pageHero('Our Solutions', 'Tailored insurance solutions designed to meet your unique operational needs.', categories['general-insurance'].heroImage, btn('Claims', '/claims') + btn('Talk to Us', '/contact-us', 'btn-orange')) + `
<section class="featured"><div class="wrap"><h2>Featured Solutions</h2><div class="card-grid three">${D.home.featured.map(f => `<article class="card">${img(f.image, f.title)}<div class="card-body"><h3>${esc(f.title)}</h3><p>${esc(f.text)}</p>${btn('Learn More', f.href, 'btn-sm')}</div></article>`).join('')}</div></div></section>
${spotlight()}
${Object.keys(CAT_META).map(cat => `<section class="cat-block"><div class="wrap"><h2><a href="${url('/solutions/' + cat)}">${CAT_META[cat].title}</a></h2>${productGrid(cat)}</div></section>`).join('')}
${whyChoose()}${ctaBand()}`;
  await page('/solutions', 'Solutions', body, { description: 'All Trinity insurance solutions: general insurance, employee benefits and service solutions.' });
  for (const cat of Object.keys(CAT_META)) {
    const c = categories[cat];
    const body = pageHero(CAT_META[cat].title, c.tagline || CAT_META[cat].tagline, c.heroImage, btn('Get a Quote', '/contact-us') + btn('Talk to Us', '/contact-us', 'btn-orange')) + `
<section class="featured"><div class="wrap"><h2>Featured Solutions</h2><div class="card-grid three">${c.featured.map(f => `<article class="card">${img(f.image, f.title)}<div class="card-body"><h3>${esc(f.title)}</h3><p>${esc(f.text)}</p>${btn('Learn More', f.href, 'btn-sm')}</div></article>`).join('')}</div></div></section>
${cat === 'general-insurance' ? spotlight() : ''}<section class="cat-block"><div class="wrap"><h2>Explore Our Solutions</h2>${productGrid(cat)}</div></section>
${whyChoose()}${ctaBand()}`;
    await page('/solutions/' + cat, CAT_META[cat].title, body, { description: `${CAT_META[cat].title} from Trinity Insurance Brokers: ${productList(cat).map(prodTitle).join(', ')}.`, schema: [{ '@type': 'ItemList', name: CAT_META[cat].title, itemListElement: productList(cat).map((p, i) => ({ '@type': 'ListItem', position: i + 1, name: prodTitle(p), url: site.url + p.path })) }] });
  }
}

// ---------- PRODUCT PAGES ----------
const renderSection = s => {
  // "Item A / Item B" + one "o x o y" paragraph per item → labelled checklists side by side
  if (s.items.length && s.paras.length === s.items.length && s.paras.every(t => /^o\s/.test(t))) {
    return `<div class="p-sec">${s.icon ? `<div class="p-ic">${img(s.icon, '')}</div>` : ''}<div class="p-body">${s.title ? `<h3>${esc(s.title)}</h3>` : ''}<div class="req-cols">${s.items.map((it, i) => `<div><p class="req-h">${esc(it)}</p><ul class="ticks">${s.paras[i].replace(/^o\s+/, '').split(/\s+o\s+/).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`).join('')}</div></div></div>`;
  }
  const items = s.items.map(t => t.replace(/^\s*o\s+/, ''));
  const listHtml = items.length ? `<ul class="ticks">${items.map(t => {
    const m = t.match(/^([A-Z][A-Z &'’-]{3,})\.\s*(.*)$/); // "KNOWLEDGE & EXPERTISE. text"
    if (m) return `<li><strong>${esc(sentenceCase(m[1]))}.</strong> ${esc(m[2])}</li>`;
    const sub = t.split(/\s+o\s+/);
    return sub.length > 1 ? `<li>${esc(sub[0])}<ul>${sub.slice(1).map(x => `<li>${esc(x)}</li>`).join('')}</ul></li>` : `<li>${esc(t)}</li>`;
  }).join('')}</ul>` : '';
  const lead = s.parasAfterLead ? s.paras.slice(0, s.parasAfterLead) : [], rest = s.parasAfterLead ? s.paras.slice(s.parasAfterLead) : s.paras;
  const restFirst = false;
  return `<div class="p-sec${s.kind === 'why' ? ' p-why' : ''}">${s.icon ? `<div class="p-ic">${img(s.icon, '')}</div>` : ''}<div class="p-body">${s.title ? `<h3>${esc(s.title)}</h3>` : ''}${lead.map(t => `<p>${esc(t)}</p>`).join('')}${s.parasAfterLead || restFirst ? listHtml + rest.map(t => `<p>${esc(t)}</p>`).join('') : rest.map(t => `<p>${esc(t)}</p>`).join('') + listHtml}${(s.buttons || []).map(b => btn(b.text, b.href)).join(' ')}</div></div>`;
};
const premiumTable = s => {
  // Wix premium tables arrive as "VALUE, rows…, PREMIUM, rows…"
  const pi = s.paras.findIndex(t => /^premium$/i.test(t));
  if (!/^value$/i.test(s.paras[0] || '') || pi < 0) return null;
  const vals = s.paras.slice(1, pi), prem = s.paras.slice(pi + 1);
  return `<div class="p-sec">${s.icon ? `<div class="p-ic">${img(s.icon, '')}</div>` : ''}<div class="p-body"><h3>${esc(s.title)}</h3><table class="premium"><thead><tr><th>Value</th><th>Premium</th></tr></thead><tbody>${vals.map((v, i) => `<tr><td>${esc(v)}</td><td>${esc(prem[i] || '')}</td></tr>`).join('')}</tbody></table></div></div>`;
};
for (const p of Object.values(products)) {
  const isShop = p.path.startsWith('/shop/');
  const title = isShop ? sentenceCase(p.title).replace('Insurance', 'Insurance') : prodTitle(p);
  const intro = p.intro.filter(t => !/^​?$/.test(t));
  let secs = p.sections.filter(s => s.kind !== 'why');
  const travel = p.path === '/shop/travel-insurance';
  const heroBtns = travel ? btn('Proceed to Starr Portal', D.starrPortal, 'btn-orange') : isShop ? btn('Inquire Now', '#inquire', 'btn-orange') : btn('Inquire Now', '#inquire', 'btn-orange');
  let bodySecs = secs.map(s => premiumTable(s) || renderSection(s)).join('');
  if (travel) {
    // Travel: coverage icons grid + Starr portal call to action (no Get a Quote / Our Solutions)
    const w = wix['/shop/travel-insurance'].blocks;
    const ci = w.findIndex(b => /major coverage/i.test(b.text || ''));
    const cov = []; for (let i = ci + 1; i < w.length; i++) { if (w[i].t.startsWith('h')) break; if (w[i].t === 'img' && w[i + 1]?.t === 'p') { cov.push({ img: w[i].src, t: w[i + 1].text }); i++; } }
    bodySecs = `<h3 class="tc">The following are just some of the major coverage and benefits:</h3><div class="cov-grid">${cov.map(c => `<div>${img(c.img, '')}<p>${esc(c.t)}</p></div>`).join('')}<div class="more"><p>and more</p></div></div>
      <div class="starr-cta"><h3>Ready to secure your trip?</h3><p>Click “Proceed” below to get your Travel Insurance. You'll be redirected to STARR Insurance's Travel Insurance portal.</p>${btn('Proceed', D.starrPortal, 'btn-orange')}<p class="muted">For any questions or assistance, email us at <a href="mailto:${site.email}">${site.email}</a>.</p></div>`;
  }
  const body = `<section class="prod-hero"><div class="wrap">${p.heroImage && !isShop ? img(p.heroImage, title, 'prod-banner') : ''}<div class="prod-head"><p class="crumbs"><a href="${url('/solutions')}">Solutions</a> / ${isShop ? 'Shop' : `<a href="${url('/solutions/' + p.category)}">${CAT_META[p.category]?.title}</a>`}</p><h1>${esc(title)}</h1>${intro.map(t => t.includes('•') ? (() => { const [h, ...li] = t.split(/\s*•\s*/); return (h.trim() ? `<p>${esc(h.trim())}</p>` : '') + `<ul class="ticks">${li.filter(Boolean).map(x => `<li>${esc(x)}</li>`).join('')}</ul>`; })() : `<p>${esc(t)}</p>`).join('')}<div class="btns">${heroBtns}</div></div></div></section>
<section class="prod-body"><div class="wrap narrow">${bodySecs}${p.cta ? `<div class="p-cta">${p.cta.icon ? img(p.cta.icon, '') : ''}<p>${esc(p.cta.text)}</p>${btn('Inquire Now', '#inquire', 'btn-orange')}</div>` : ''}</div></section>
${whyChoose()}${travel ? '' : formSection(isShop ? 'shop' : 'product', "Let's Talk", undefined, title)}`;
  await page(p.path, title, body, { description: (intro[0] || '').slice(0, 158), image: p.heroImage, schema: [{ '@type': 'Service', '@id': site.url + p.path + '#service', name: title, serviceType: title, category: isShop ? 'Personal insurance' : CAT_META[p.category]?.title, description: intro.join(' ').slice(0, 500), provider: { '@id': ORG_ID }, areaServed: { '@type': 'Country', name: 'Philippines' }, url: site.url + p.path }] });
}

// ---------- CLAIMS (hub + one guide per claim type) ----------
const CLAIM_TYPES = (() => {
  const src = k => (shop['/pages/' + k]?.sections || []).map(s => s.html).join('');
  const allClaims = src('claims');
  const othersHtml = (() => { const i = allClaims.indexOf('<div><p><strong>Pre-Approval'); if (i < 0) return ''; const j = allClaims.indexOf('</div>', i); return allClaims.slice(i, j); })();
  return [
    { id: 'motor', name: 'Motor Claims', short: 'Motor', form: 'Motor', icon: 'car', d: 'Own damage, third-party liability, carnap and theft.', html: src('motor-claims') },
    { id: 'non-motor', name: 'Non-motor Claims', short: 'Non-motor', form: 'Non-motor', icon: 'claim', d: 'How non-motor losses are reported, inspected and settled.', html: src('non-motor-claims') },
    { id: 'property-fire', name: 'Property / Fire Claims', short: 'Property / Fire', form: 'Property / Fire', icon: 'fire', d: 'Building, contents, stock and machinery losses.', html: src('property-fire-claims') },
    { id: 'marine-cargo', name: 'Marine and Cargo Hull Claims', short: 'Marine & Cargo', form: 'Marine and Cargo Hull', icon: 'ship', d: 'Cargo damage, short-landed and short-delivered shipments.', html: src('marine-and-cargo-hull-claims') },
    { id: 'hmo-medical', name: 'HMO / Medical Claims', short: 'HMO / Medical', form: 'HMO / Medical', icon: 'hmo', d: 'Inpatient, outpatient, financial assistance, life and accident.', html: src('hmo-medical-claims') },
    { id: 'travel', name: 'Travel Insurance Claims', short: 'Travel', form: 'Travel', icon: 'plane', d: 'Medical, accident, baggage, delays and cancellations.', html: src('travel-insurance-claims') },
    { id: 'pre-approval-dental', name: 'Pre-approvals, Treatment Plans and Dental', short: 'Pre-approval & Dental', form: 'Pre-approval / Treatment plan / Dental', icon: 'heartpulse', d: 'Planned admissions, therapy treatment plans, follow-up care and dental.', html: othersHtml }
  ].filter(t => t.html);
})();
{
  const w = wix['/claims'].blocks;
  const how = [
    { icon: 'phone', t: 'Report right away', d: 'Notify Trinity or your account manager as soon as the incident happens, with your policy number and a short description.' },
    { icon: 'shield', t: 'Protect and document', d: 'Prevent further damage, keep damaged items for inspection and take clear photos.' },
    { icon: 'claim', t: 'Submit the requirements', d: 'Send complete, clear and readable documents. Each claim guide lists exactly what is needed.' },
    { icon: 'search', t: 'Assessment', d: 'We report the claim to the insurer, who may assign an accredited adjuster to inspect and evaluate the loss.' },
    { icon: 'check', t: 'Settlement', d: 'Once the claim is evaluated and approved, we follow it through with the insurer until it is settled.' }
  ];
  const helpStrip = `<section class="help-strip"><div class="wrap"><div><h2>Need help right now?</h2><p>Our claims team will walk you through what to do next.</p></div><div class="help-actions"><a href="tel:+63288101653">${icon('phone', 'ic')}<span><small>Call us</small>+632 8810 1653</span></a><a href="mailto:${site.email}">${icon('mail', 'ic')}<span><small>Email us</small>${site.email}</span></a></div></div></section>`;
  const body = `<section class="claims-hero"><div class="wrap"><p class="eyebrow-lg">Claims Assistance</p><h1>We'll guide you through every claim.</h1><p>${esc(w.find(b => b.t === 'p')?.text || '')}</p><div class="btns">${btn('Start a claim', '#inquire', 'btn-orange')}${btn('See what you need', '#types', 'btn-light')}</div></div></section>
<section class="sec" id="types"><div class="wrap"><h2>What type of claim are you filing?</h2><p class="lead tc">Choose a claim type to see the steps and a printable checklist of documents.</p>
<div class="ctype-grid">${CLAIM_TYPES.map(t => `<a class="ctype" href="${url('/claims/' + t.id)}"><span class="ctype-ic">${icon(t.icon, 'ic')}</span><strong>${esc(t.name)}</strong><small>${esc(t.d)}</small><span class="ctype-go">View guide ${icon('arrow', 'ic')}</span></a>`).join('')}<a class="ctype ghost" href="#inquire"><span class="ctype-ic">${icon('info', 'ic')}</span><strong>Not sure?</strong><small>Tell us what happened and we'll point you to the right process.</small><span class="ctype-go">Ask our team ${icon('arrow', 'ic')}</span></a></div></div></section>
<section class="sec claims-how"><div class="wrap"><h2>How the claims process works</h2>${steps(how, 'five')}</div></section>
${helpStrip}
${formSection('claim', 'Start a claim', 'Send us the basics and a claims officer will contact you within one business day. All information provided remains private and secure.')}`;
  await page('/claims', 'Claims', body, { description: 'File motor, non-motor, property/fire, marine, HMO/medical and travel insurance claims with Trinity: step-by-step guides and document checklists.', schema: [{ '@type': 'HowTo', name: 'How to file an insurance claim with Trinity', step: how.map((h, i) => ({ '@type': 'HowToStep', position: i + 1, name: h.t, text: h.d })) }] });

  for (const t of CLAIM_TYPES) {
    let h = rewrite(polish(t.html, { level: 2 }).html);
    // document lists that sit right under a heading or an "…requirements:" line become interactive checklists
    h = h.replace(/(<\/h[23]>|<p class="lead-in">[\s\S]*?<\/p>)(\s*)<(ul|ol) class="(ticks|steps)">/g, (m, a, sp, tag, cls) => `${a}${sp}<${tag} class="${cls} checklist">`);
    h = h.replace(/(denied:?\s*<\/p>)(\s*)<ol class="steps">/g, '$1$2<ol class="warn-list">');
    const body = `<section class="claim-hero"><div class="wrap"><p class="crumbs"><a href="${url('/claims')}">Claims</a> / ${esc(t.short)}</p><div class="ch-row"><span class="ctype-ic big">${icon(t.icon, 'ic')}</span><div><h1>${esc(t.name)}</h1><p>${esc(t.d)}</p></div></div><div class="btns">${btn('File this claim', '#inquire', 'btn-orange')}<button type="button" class="btn btn-light" data-print>${icon('download', 'ic')} Print checklist</button></div></div></section>
<section class="sec claim-guide"><div class="wrap cg-layout">
<aside class="cg-nav" aria-label="Claim types"><p class="toc-title">Claim types</p><ul>${CLAIM_TYPES.map(x => `<li><a href="${url('/claims/' + x.id)}"${x === t ? ' aria-current="page"' : ''}>${icon(x.icon, 'ic')}${esc(x.short)}</a></li>`).join('')}</ul><a class="cg-help" href="tel:+63288101653">${icon('phone', 'ic')}<span><small>Claims hotline</small>+632 8810 1653</span></a></aside>
<div class="cg-main">
<div class="cg-facts"><div>${icon('clock', 'ic')}<p><strong>Report early</strong>Late reporting is a common reason claims are delayed or denied.</p></div><div>${icon('doc', 'ic')}<p><strong>Keep originals</strong>Hold on to receipts, reports and damaged items until the claim is settled.</p></div><div>${icon('check', 'ic')}<p><strong>Tick as you go</strong>Use the checklists below to track the documents you have ready.</p></div></div>
<div class="rte cg-body">${h}</div>
<p class="note-box">${icon('info', 'ic')}<span>The insurer or the assigned adjuster may request additional documents while evaluating a claim. Our team will tell you exactly what is needed.</span></p>
</div></div></section>
${formSection('claim', 'File this claim', 'Send us the basics and a claims officer will contact you within one business day.', t.form)}`;
    await page('/claims/' + t.id, t.name, body, { description: `${t.name} with Trinity Insurance Brokers: steps to take and a checklist of required documents. ${t.d}`, schema: [{ '@type': 'HowTo', name: `How to file ${t.name.toLowerCase()} with Trinity`, description: t.d, tool: [], step: [{ '@type': 'HowToStep', name: 'Report the incident to Trinity', text: 'Notify Trinity or your account manager as soon as possible.' }, { '@type': 'HowToStep', name: 'Prepare the required documents', text: 'Complete the document checklist for this claim type.' }, { '@type': 'HowToStep', name: 'Submit your claim', text: 'Send the documents to Trinity; we coordinate with the insurer until settlement.' }] }] });
  }
}

// ---------- CAREERS ----------
const CAREERS = JSON.parse(await readFile('content/v2/careers.json', 'utf8'));
const roleSlug = r => r.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
{
  const w = wix['/careers'].blocks;
  const sec = (h) => { const i = w.findIndex(b => b.t.startsWith('h') && b.text.toUpperCase() === h.toUpperCase()); const ps = []; for (let j = i + 1; j < w.length && (w[j].t === 'p' || w[j].t === 'img'); j++) if (w[j].t === 'p') ps.push(w[j].text); return ps; };
  const vals = ['EXCELLENCE', 'INTEGRITY', 'COLLABORATION', 'GROWTH'].map(v => ({ t: sentenceCase(v), d: sec(v)[0], img: w[w.findIndex(b => b.text === v) - 1]?.src }));
  const blocks = ['Challenging Career', 'Supportive Management', 'Meaningful Work'].map((h, i) => ({ h, ps: sec(h), img: w.filter(x => x.t === 'img' && /webp/.test(x.src))[i]?.src }));
  const testi = []; for (let i = 0; i < w.length; i++) if (w[i].t === 'h5') testi.push({ img: w[i - 1]?.t === 'img' ? w[i - 1].src : null, n: w[i].text, r: w[i + 1]?.text, q: w[i + 2]?.text });
  const life = w.slice(w.findIndex(b => /life at trinity/i.test(b.text || ''))).filter(b => b.t === 'img').slice(0, 4).map(b => b.src);
  const open = CAREERS.openings || [];
  const rolesAttr = esc(JSON.stringify(open.map(r => ({ title: r.title }))));
  const roleCard = r => `<a class="role-card" href="${url('/careers/' + roleSlug(r))}"><div><p class="kicker">${esc(r.team || 'Trinity')}</p><h3>${esc(r.title)}</h3><p class="role-meta"><span>${icon('building', 'ic')}${esc(r.location || 'Makati')}</span><span>${icon('clock', 'ic')}${esc(r.type || 'Full-time')}</span></p></div><span class="role-go">View role ${icon('arrow', 'ic')}</span></a>`;
  const applyForm = (subject = '') => `<section class="sec apply" id="apply"><div class="wrap apply-grid"><div class="apply-intro"><p class="eyebrow-lg">Apply</p><h2>Apply in about three minutes.</h2><p>${open.length ? 'Choose a role below, or send a general application and we will keep your profile on file.' : 'There are no open roles right now, but we are always glad to meet good people. Send your profile and our HR team will keep it on file for future openings.'}</p><ul class="ticks"><li>Your CV in PDF or Word (up to 10 MB)</li><li>Your LinkedIn profile, if you have one</li><li>A few lines on why Trinity (optional)</li></ul><p class="muted">Your details are used only for recruitment, in line with our <a href="${url('/privacy-policy')}">Privacy Policy</a>.</p></div><div class="apply-card"><div data-form="career" data-roles="${rolesAttr}" data-subject="${esc(subject)}"></div></div></div></section>`;
  const body = `<section class="careers-hero"><div class="wrap ch-grid"><div><p class="eyebrow-lg">Careers at Trinity</p><h1>Build your career. Make an impact.</h1><p>Be part of one of the leading independent insurance brokers in the Philippines, helping businesses and families protect what matters since 1987.</p><div class="btns">${btn(open.length ? `See ${open.length} open role${open.length > 1 ? 's' : ''}` : 'See open roles', '#openings', 'btn-orange')}${btn('Send your CV', '#apply', 'btn-ghost')}</div></div><div class="ch-media">${img(w.find(b => b.t === 'img')?.src, 'The Trinity team', 'rounded')}</div></div></section>
<section class="facts-strip"><div class="wrap"><div><strong>Since 1987</strong><span>Nearly 40 years in insurance broking</span></div><div><strong>Makati &amp; Cebu</strong><span>Two offices serving clients nationwide</span></div><div><strong>Global network</strong><span>Brokerslink and international partners</span></div></div></section>
<section class="sec"><div class="wrap split"><div><p class="eyebrow-lg">Who we are</p><h2 class="tl">A team that takes care of people</h2><p>${esc(sec('WHO WE ARE')[0] || '')}</p></div><div class="card-grid two mini-values">${vals.map(v => `<div class="value-card sm">${img(v.img, '')}<h3>${esc(v.t)}</h3><p>${esc(v.d)}</p></div>`).join('')}</div></div></section>
<section class="sec alt"><div class="wrap"><h2>Why join Trinity?</h2><p class="lead tc">${esc(sec('WHY JOIN TRINITY?')[0] || '')}</p><div class="card-grid three">${blocks.map(b => `<article class="feature-card">${img(b.img, b.h)}<div><h3>${esc(b.h)}</h3>${b.ps.slice(0, 2).map(t => `<p>${esc(t)}</p>`).join('')}</div></article>`).join('')}</div></div></section>
<section class="sec" id="openings"><div class="wrap"><h2>Open roles</h2>${open.length ? `<div class="roles">${open.map(roleCard).join('')}</div>` : `<div class="empty-roles">${icon('usercheck', 'ic')}<div><h3>No open roles right now</h3><p>We post new roles here as soon as they open. In the meantime, join our talent pool and we'll reach out when there's a match.</p></div>${btn('Join the talent pool', '#apply', 'btn-orange')}</div>`}</div></section>
<section class="sec alt apply-how"><div class="wrap"><h2>Our hiring process</h2>${steps([{ icon: 'send', t: 'Apply', d: 'Send your profile and CV online. It takes about three minutes.' }, { icon: 'usercheck', t: 'HR review', d: 'Our HR team reviews every application against our open roles.' }, { icon: 'phone', t: 'Interviews', d: 'Shortlisted applicants are contacted by HR for interviews.' }, { icon: 'check', t: 'Welcome to Trinity', d: 'Successful candidates receive an offer and an onboarding plan.' }])}</div></section>
${testi.length ? `<section class="sec testimonials"><div class="wrap"><h2>Hear from our team</h2><div class="card-grid three">${testi.map(t => `<figure class="testi">${img(t.img, t.n)}<blockquote>“${esc((t.q || '').replace(/^[\s"“”]+|[\s"“”]+$/g, ''))}”</blockquote><figcaption><strong>${esc(t.n)}</strong><br>${esc(t.r)}</figcaption></figure>`).join('')}</div></div></section>` : ''}
${life.length ? `<section class="life"><div class="wrap"><div class="life-head"><div><p class="eyebrow-lg">Life at Trinity</p><h2 class="tl">Work hard, celebrate together.</h2><p>Team building, milestones and everyday moments with the Trinity family.</p></div><div class="life-follow"><span>Follow along</span>${SOCIAL.map(x => `<a href="${x.href}" target="_blank" rel="noopener" aria-label="${x.label}">${icon(x.icon)}</a>`).join('')}</div></div><div class="mosaic">${life.map((s2, i) => `<figure class="m${i}">${img(s2, 'Life at Trinity')}</figure>`).join('')}<a class="mosaic-cta" href="#apply"><span>Want to be in the next photo?</span><strong>Join the team ${icon('arrow', 'ic')}</strong></a></div></div></section>` : ''}
${applyForm()}`;
  await page('/careers', 'Careers', body, { description: 'Careers at Trinity Insurance Brokers Inc. – open roles, why join us, our hiring process and life at Trinity.' });
  for (const r of open) {
    const slug = '/careers/' + roleSlug(r);
    const body2 = `<section class="careers-hero role"><div class="wrap"><p class="crumbs"><a href="${url('/careers')}">Careers</a> / Open roles</p><p class="kicker">${esc(r.team || '')}</p><h1>${esc(r.title)}</h1><p class="role-meta"><span>${icon('building', 'ic')}${esc(r.location || 'Makati')}</span><span>${icon('clock', 'ic')}${esc(r.type || 'Full-time')}</span>${r.posted ? `<span>${icon('calendar', 'ic')}Posted ${esc(fmtDate(r.posted))}</span>` : ''}</p><div class="btns">${btn('Apply for this role', '#apply', 'btn-orange')}</div></div></section>
<section class="sec"><div class="wrap narrow rte">${r.summary ? `<p class="dek">${esc(r.summary)}</p>` : ''}${r.responsibilities?.length ? `<h2>What you'll do</h2><ul class="ticks">${r.responsibilities.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}${r.qualifications?.length ? `<h2>What we're looking for</h2><ul class="ticks">${r.qualifications.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</div></section>
${applyForm(r.title)}`;
    await page(slug, r.title, body2, { description: `${r.title} – ${r.location || 'Makati'} – careers at Trinity Insurance Brokers.`, schema: [{ '@type': 'JobPosting', title: r.title, description: [r.summary, ...(r.responsibilities || []), ...(r.qualifications || [])].filter(Boolean).join(' '), datePosted: r.posted, employmentType: (r.type || 'Full-time').toUpperCase().replace('-', '_'), hiringOrganization: { '@id': ORG_ID }, jobLocation: { '@type': 'Place', address: { '@type': 'PostalAddress', addressLocality: /cebu/i.test(r.location || '') ? 'Cebu City' : 'Makati City', addressCountry: 'PH' } } }] });
  }
}

// ---------- CONTACT ----------
{
  const body = pageHero('Contact Us', "We're here to help. Tell us what you need and the right team will get back to you.") + `
<section class="contact"><div class="wrap contact-grid">
  <div class="contact-form-card"><h2>Send us a message</h2><p>Choose a topic so we can route your message to the right team.</p><div data-form="contact"></div></div>
  <div class="contact-info"><h2>Get in touch</h2>
    <div class="ci">${icon('phone')}<div><strong>Call us</strong><p><a href="tel:+63288101653">+632 8810 1653</a></p></div></div>
    <div class="ci">${icon('mail')}<div><strong>Email us</strong><p><a href="mailto:${site.email}">${site.email}</a></p></div></div>
    <div class="ci">${icon('clock')}<div><strong>Office hours</strong><p>Mon – Fri: 8:30 AM – 5:30 PM</p></div></div>
    <div class="quick-links"><a href="${url('/claims')}">${icon('claim', 'ic')}<span><strong>File a claim</strong><small>Guides and checklists</small></span></a><a href="${url('/careers')}">${icon('briefcase', 'ic')}<span><strong>Careers</strong><small>Open roles and applications</small></span></a></div>
    <h3>Makati Head Office</h3><p>7504 Bagtikan St., San Antonio Village, Makati City, 1203 Metro Manila<br>Telephone: +632 8810 1653</p>
    <h3>Cebu Office</h3><p>Unit 610 The Meridian by Avenir, Golam Drive, Brgy. Kasambagan, 6000 Cebu City<br>Telephone: +632 887 4002</p>
    <p>${btn('Open in Google Maps', 'https://www.google.com/maps/search/?api=1&query=7504+Bagtikan+St+San+Antonio+Village+Makati', 'btn-sm')}</p>
  </div>
</div></section>`;
  await page('/contact-us', 'Contact Us', body, { description: 'Contact Trinity Insurance Brokers – quotes, policy questions, claims and careers. Makati head office and Cebu office.', schema: [{ '@type': 'ContactPage', url: site.url + '/contact-us', about: { '@id': ORG_ID } }] });
}

// ---------- CLIENT PORTAL (exploratory: general registration form, not part of launch) ----------
{
  const body = `<section class="portal-hero"><div class="wrap"><p class="eyebrow-lg">Client Portal</p><h1>Create your client account.</h1><p>Register once to access your Trinity client account.</p></div></section>
<section class="sec portal" id="register"><div class="wrap narrow"><div class="portal-card"><div data-form="portal"></div></div></div></section>`;
  await page('/client-portal', 'Client Portal', body, { noindex: true, description: 'Trinity Client Portal registration.' });
}

// ---------- PAYMENTS ----------
await page('/payments', 'Payments', pageHero('Payments', 'Premium payment channels for Trinity clients.') + `<section class="sec"><div class="wrap"><h2>How to Pay Your Premium</h2>${steps([{ icon: 'send', t: 'Send your policy details', d: 'Use the form below or email us with your policy number and the billing you would like to settle.' }, { icon: 'mail', t: 'Receive official instructions', d: 'Your account officer replies with the official payment channels and the exact amount due.' }, { icon: 'card', t: 'Pay and send proof', d: 'Settle through the channel provided and reply with your proof of payment.' }, { icon: 'check', t: 'Get your confirmation', d: 'Our team confirms once your payment has been received.' }])}
<p class="note-box warn">${icon('lock', 'ic')}<span><strong>Stay safe:</strong> Only pay through the official channels provided by your Trinity account officer. If you receive payment details from anyone else, confirm them first with your account officer or at <a href="mailto:${site.email}">${site.email}</a> before sending funds.</span></p></div></section>${formSection('payment', 'Payment Inquiry', 'Send us your policy details and our team will reply with the payment instructions.')}`, { description: 'How to pay your insurance premium with Trinity Insurance Brokers.' });

// ---------- LEGAL PAGES (from the live site) ----------
for (const [old, path, title] of [['/pages/privacy-policy', '/privacy-policy', 'Privacy Policy'], ['/pages/terms-and-conditions', '/terms-and-conditions', 'Terms & Conditions'], ['/pages/disclaimer', '/disclaimer', 'Disclaimer'], ['/pages/cybersecurity', '/cybersecurity', 'Cybersecurity'], ['/pages/data-privacy-consent-form', '/data-privacy-consent-form', 'Data Privacy Consent Form']]) {
  const sh = shop[old]; if (!sh) continue;
  const r = polish(sh.sections.map(s => s.html).join(''));
  const toc = pickToc(r.toc);
  const body = pageHero(title) + `<section class="sec doc-page"><div class="wrap${toc.length >= 3 ? ' doc-layout' : ' narrow'}">${toc.length >= 3 ? `<aside>${tocBox(toc, 'Contents')}</aside>` : ''}<div class="rte doc-body">${rewrite(r.html)}<p class="doc-help">${icon('mail', 'ic')}<span>Questions about this page? Email <a href="mailto:${site.email}">${site.email}</a> or call <a href="tel:+63288101653">+632 8810 1653</a>.</span></p></div></div></section>`;
  await page(path, title, body, { description: sh.description });
}

// ---------- BLOG ----------
const newsPosts = posts.filter(p => p.blog === 'news');
const postUrl = a => url('/blog/' + a.path.split('/').pop());
const CATS = ['Health & Wellness', 'Insurance Insights', 'Trinity News'];
{
  const withBody = newsPosts.filter(a => a.image && a.html && a.html.length > 400);
  const lead = withBody[0], side = withBody.slice(1, 4);
  const count = c => newsPosts.filter(a => category(a) === c).length;
  const body = `<section class="blog-head"><div class="wrap"><p class="eyebrow-lg">Trinity Insights</p><h1>The Trinity Blog</h1><p>Health, insurance and risk management insights from the people who have protected Filipino businesses since 1987.</p></div></section>
<section class="blog-lead"><div class="wrap lead-grid">
  <article class="lead-story"><a href="${postUrl(lead)}" class="thumb" style="background-image:url('${media(lead.image)}')" aria-label="${esc(lead.title)}"></a><div><p class="kicker">${esc(category(lead))} · Latest</p><h2><a href="${postUrl(lead)}">${esc(lead.title)}</a></h2><p class="excerpt">${esc((lead.excerpt || '').slice(0, 220))}…</p><p class="post-meta"><time>${esc(fmtDate(lead.date))}</time><span>${readingTime(lead.html)} min read</span></p><a class="more-link" href="${postUrl(lead)}">Read the story ${icon('arrow', 'ic')}</a></div></article>
  <div class="lead-side"><p class="side-title">More recent stories</p>${side.map(a => `<article><a href="${postUrl(a)}" class="mini-thumb" style="background-image:url('${media(a.image)}')" aria-hidden="true" tabindex="-1"></a><div><p class="kicker">${esc(category(a))}</p><h3><a href="${postUrl(a)}">${esc(a.title)}</a></h3><p class="post-meta"><time>${esc(fmtDate(a.date))}</time></p></div></article>`).join('')}</div>
</div></section>
<section class="sec blog-list"><div class="wrap"><div class="blog-tools"><div class="chips" role="tablist" aria-label="Filter by topic"><button class="on" data-cat="">All <span>${newsPosts.length}</span></button>${CATS.map(c => `<button data-cat="${esc(c)}">${esc(c)} <span>${count(c)}</span></button>`).join('')}</div><input id="blog-q" type="search" class="search-input" placeholder="Search articles…" aria-label="Search articles"></div><div class="post-grid" data-paginate="12">${newsPosts.map(postCard).join('')}</div><p class="no-results" hidden>No articles match your search.</p><nav class="pager" aria-label="Pagination"></nav></div></section>
<section class="newsletter-band"><div class="wrap"><div><h2>Have a question about your cover?</h2><p>Our brokers can explain what your policy covers and what it doesn't, in plain language.</p></div><div class="btns">${btn('Talk to Us', '/contact-us', 'btn-orange')}${btn('Explore Solutions', '/solutions', 'btn-light')}</div></div></section>`;
  await page('/blog', 'Blog', body, { description: 'Trinity Insurance Brokers blog: health and wellness, insurance insights and Trinity news.', schema: [{ '@type': 'Blog', '@id': site.url + '/blog#blog', name: 'The Trinity Blog', publisher: { '@id': ORG_ID }, inLanguage: 'en-PH', blogPost: newsPosts.slice(0, 20).map(a => ({ '@type': 'BlogPosting', headline: a.title.slice(0, 110), url: site.url + '/blog/' + a.path.split('/').pop() })) }] });
}
for (let i = 0; i < newsPosts.length; i++) {
  const a = newsPosts[i], prev = newsPosts[i + 1], next = newsPosts[i - 1];
  const slug = '/blog/' + a.path.split('/').pop();
  const cat = category(a);
  const r = polish(a.html), toc = pickToc(r.toc);
  const e = enhance(r.html, a.title), mins = Math.max(1, Math.round(e.words / 220));
  const infographic = e.words < 60;
  const related = [...newsPosts.filter(x => x !== a && x.tags?.some(t => a.tags?.includes(t) && !/trinity (health blast|news)/i.test(t))), ...newsPosts.filter(x => x !== a && category(x) === cat)].filter((x, j, arr) => arr.indexOf(x) === j).slice(0, 3);
  const share = encodeURIComponent(site.url + slug), stitle = encodeURIComponent(a.title);
  const health = cat === 'Health & Wellness';
  const iso = (() => { const t = new Date(String(a.date).replace(/ ([+-]\d{2})(\d{2})$/, '$1:$2').replace(' ', 'T')); return isNaN(t) ? null : t.toISOString(); })();
  const shareBox = `<div class="share"><span>Share</span><a href="https://www.linkedin.com/sharing/share-offsite/?url=${share}" target="_blank" rel="noopener" aria-label="Share on LinkedIn">${icon('linkedin', 'ic')}</a><a href="https://www.facebook.com/sharer/sharer.php?u=${share}" target="_blank" rel="noopener" aria-label="Share on Facebook">${icon('facebook', 'ic')}</a><a href="mailto:?subject=${stitle}&body=${share}" aria-label="Share by email">${icon('mail', 'ic')}</a><button type="button" class="copy-link" data-url="${esc(site.url + slug)}" aria-label="Copy link">${icon('link', 'ic')}</button></div>`;
  const cta = `<aside class="post-cta"><span class="pr-ic">${icon(health ? 'hmo' : 'shield', 'ic')}</span><div><h2>${health ? 'Looking after your team’s health?' : 'Need help protecting your business?'}</h2><p>${health ? 'Trinity designs HMO, group medical and wellness programs that keep your people healthy and productive.' : 'Talk to our team about insurance and risk management solutions tailored to your business.'}</p>${btn(health ? 'Explore Employee Benefits' : 'Explore Our Solutions', health ? '/solutions/employee-benefits' : '/solutions', 'btn-sm btn-light')} ${btn('Talk to Us', '/contact-us', 'btn-sm btn-orange')}</div></aside>`;
  const standfirstHtml = e.standfirst ? `<p class="dek">${esc(e.standfirst)}</p>` : '';
  const bodyHtml = e.html.replace(/<p class="standfirst">[\s\S]*?<\/p>/, '');
  const body = `<div class="read-progress" aria-hidden="true"><span></span></div>
<article class="post" itemscope itemtype="https://schema.org/BlogPosting">
<header class="post-hero"><div class="wrap post-head"><p class="crumbs"><a href="${url('/blog')}">Blog</a> / <span>${esc(cat)}</span></p><p class="kicker">${esc(cat)}</p><h1 itemprop="headline">${esc(a.title)}</h1>${standfirstHtml}<div class="byline-row"><span class="avatar" aria-hidden="true">T</span><div><strong>Trinity Editorial Team</strong><p class="post-meta">${a.date ? `<time datetime="${esc(iso || '')}" itemprop="datePublished">${esc(fmtDate(a.date))}</time>` : ''}${infographic ? '<span>Infographic</span>' : `<span>${mins} min read</span>`}</p></div></div></div></header>
${a.image ? `<div class="wrap post-feature">${img(a.image, a.title, 'feature' + (infographic ? ' infographic' : ''))}</div>` : ''}
<div class="wrap post-layout${infographic ? ' solo' : ''}"><div class="post-main">
${e.takeaways.length ? `<section class="takeaways" aria-label="Key takeaways"><p class="tk-title">${icon('check', 'ic')} Key takeaways</p><ul>${e.takeaways.map(t => `<li>${esc(t)}</li>`).join('')}</ul></section>` : ''}
${toc.length >= 3 ? `<div class="toc-inline">${tocBox(toc, 'In this article')}</div>` : ''}
<div class="rte" itemprop="articleBody">${rewrite(bodyHtml)}</div>
${a.tags?.length ? `<p class="tags">${a.tags.map(t => `<span>${esc(t)}</span>`).join('')}</p>` : ''}
${shareBox}
${cta}
<nav class="post-nav" aria-label="More articles">${prev ? `<a href="${postUrl(prev)}"><small>Previous</small>${esc(prev.title)}</a>` : '<span></span>'}${next ? `<a class="next" href="${postUrl(next)}"><small>Next</small>${esc(next.title)}</a>` : '<span></span>'}</nav>
</div>${infographic ? '' : `<aside class="post-aside">${tocBox(toc, 'In this article')}${shareBox}<div class="aside-cta"><p>Questions about your cover?</p>${btn('Talk to a broker', '/contact-us', 'btn-sm')}</div></aside>`}</div>
</article>
${related.length ? `<section class="sec related"><div class="wrap"><h2>More from ${esc(cat)}</h2>${articleCards(related)}</div></section>` : ''}`;
  const schema = [{ '@type': 'BlogPosting', '@id': site.url + slug + '#article', headline: a.title.slice(0, 110), description: a.description, abstract: e.standfirst || undefined, image: a.image ? abs(a.image) : undefined, datePublished: iso || undefined, dateModified: iso || undefined, author: { '@type': 'Organization', name: 'Trinity Editorial Team', parentOrganization: { '@id': ORG_ID } }, publisher: { '@id': ORG_ID }, mainEntityOfPage: site.url + slug, articleSection: cat, wordCount: e.words || undefined, keywords: (a.tags || []).join(', ') || undefined, inLanguage: 'en-PH', isPartOf: { '@id': site.url + '/blog#blog' } }];
  if (e.faq.length >= 2) schema.push({ '@type': 'FAQPage', '@id': site.url + slug + '#faq', mainEntity: e.faq.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) });
  await emit(slug, layout({ path: slug, title: a.title, description: a.description || e.standfirst.slice(0, 158), image: a.image, body, bodyClass: 'tpl-article', type: 'article', published: iso, schema }));
  all.push(slug); searchIndex.push({ t: a.title, u: slug, d: (a.excerpt || '').slice(0, 160) });
}

// ---------- SEARCH / SITE MAP / 404 ----------
await page('/search', 'Search', pageHero('Search') + `<section class="sec"><div class="wrap narrow"><input id="q" class="search-input" type="search" placeholder="Search insurance solutions, articles…" autofocus><ul id="results" class="search-results"></ul></div></section>`, { description: 'Search the Trinity Insurance Brokers website.' });
{
  const groups = [
    ['About Us', NAV[1].children], ['Solutions', [{ label: 'All Solutions', href: '/solutions' }, ...NAV[2].children]],
    ['General Insurance', productList('general-insurance').map(p => ({ label: prodTitle(p), href: p.path }))],
    ['Employee Benefits', productList('employee-benefits').map(p => ({ label: prodTitle(p), href: p.path }))],
    ['Service Solutions', productList('service-solutions').map(p => ({ label: prodTitle(p), href: p.path }))],
    ['Shop', NAV[3].children], ['Help', [{ label: 'Claims', href: '/claims' }, { label: 'Careers', href: '/careers' }, { label: 'Payments', href: '/payments' }, { label: 'Contact Us', href: '/contact-us' }, { label: 'Blog', href: '/blog' }]],
    ['Legal', [{ label: 'Privacy Policy', href: '/privacy-policy' }, { label: 'Terms & Conditions', href: '/terms-and-conditions' }, { label: 'Disclaimer', href: '/disclaimer' }, { label: 'Cybersecurity', href: '/cybersecurity' }]]
  ];
  await page('/site-map', 'Site Map', pageHero('Site Map') + `<section class="sec"><div class="wrap sitemap">${groups.map(([g, l]) => `<div><h2>${esc(g)}</h2><ul>${l.map(x => `<li><a href="${url(x.href)}">${esc(x.label)}</a></li>`).join('')}</ul></div>`).join('')}</div></section>`, { description: 'Site map of the Trinity Insurance Brokers website.' });
}
await writeFile(join(OUT, '404.html'), layout({ path: '/404', title: 'Page not found', body: pageHero('Page not found', "Sorry, we couldn't find that page.", null, btn('Back to Home', '/')) }));

// ---------- redirects from old Shopify URLs ----------
const redirect = to => `<!doctype html><meta charset="utf-8"><title>Redirecting…</title><link rel="canonical" href="${site.url}${to}"><meta name="robots" content="noindex"><meta http-equiv="refresh" content="0; url=${url(to)}"><script>location.replace(${JSON.stringify(url(to))}+location.hash)</script><a href="${url(to)}">Continue</a>`;
const redirects = { ...OLD2NEW, '/pages/meet-our-cebu-team': '/about-us/meet-the-team', '/about-us/meet-our-cebu-team': '/about-us/meet-the-team', '/account': '/client-portal', '/account/login': '/client-portal', '/pages/client-portal': '/client-portal', '/kyc': '/client-portal', '/pages/motor-claims': '/claims/motor', '/pages/non-motor-claims': '/claims/non-motor', '/pages/property-fire-claims': '/claims/property-fire', '/pages/marine-and-cargo-hull-claims': '/claims/marine-cargo', '/pages/hmo-medical-claims': '/claims/hmo-medical', '/pages/travel-insurance-claims': '/claims/travel', '/about-us': '/about-us/corporate-profile', '/shop': '/shop/travel-insurance', '/pages/whistleblowing-form': '/about-us/corporate-governance#inquire', '/cybersercurity': '/cybersecurity' };
const WIX2OLD = {}; // old Shopify product pages -> new product pages (match by title)
for (const sp of Object.values(shop)) {
  if (!/^\/pages\//.test(sp.path) || redirects[sp.path]) continue;
  const t = (sp.hero?.title || sp.title || '').toLowerCase().replace(/[^a-z]/g, '');
  const hit = Object.values(products).find(p => prodTitle(p).toLowerCase().replace(/[^a-z]/g, '') === t);
  if (hit) redirects[sp.path] = hit.path;
}
for (const [from, to] of Object.entries(redirects)) {
  if (all.includes(from)) continue;
  const f = join(OUT, from.replace(/^\//, ''), 'index.html'); await mkdir(dirname(f), { recursive: true }); await writeFile(f, redirect(to));
}
for (const p of posts) { const f = join(OUT, p.path.replace(/^\//, ''), 'index.html'); await mkdir(dirname(f), { recursive: true }); await writeFile(f, redirect('/blog/' + p.path.split('/').pop())); }

await writeFile(join(OUT, 'search.json'), JSON.stringify(searchIndex));
const today = new Date().toISOString().slice(0, 10);
const postDate = Object.fromEntries(posts.map(p => { const t = new Date(String(p.date).replace(/ ([+-]\d{2})(\d{2})$/, '$1:$2').replace(' ', 'T')); return ['/blog/' + p.path.split('/').pop(), isNaN(t) ? today : t.toISOString().slice(0, 10)]; }));
await writeFile(join(OUT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[...new Set(all)].filter(p => p !== '/search').map(p => `<url><loc>${site.url}${p === '/' ? '/' : p}</loc><lastmod>${postDate[p] || today}</lastmod></url>`).join('\n')}\n</urlset>`);
await writeFile(join(OUT, 'robots.txt'), site.gate?.enabled ? 'User-agent: *\nDisallow: /\n' : `User-agent: *\nAllow: /\nSitemap: ${site.url}/sitemap.xml\n`);
await writeFile(join(OUT, '.nojekyll'), '');
if (process.env.CNAME) await writeFile(join(OUT, 'CNAME'), process.env.CNAME);
// Security headers (Cloudflare Pages reads _headers; GitHub Pages ignores it)
await writeFile(join(OUT, '_headers'), `/*
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
  Cross-Origin-Opener-Policy: same-origin
${IMG_MODE === 'download' ? `  Content-Security-Policy: default-src 'self'; img-src 'self' data:; media-src 'self'; font-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self' ${site.supabase.url}; form-action 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'\n` : ''}${site.gate?.enabled ? '  X-Robots-Tag: noindex, nofollow\n' : ''}
/assets/*
  Cache-Control: public, max-age=86400
/media/*
  Cache-Control: public, max-age=31536000, immutable
`);

// ---------- download media (CI) ----------
if (IMG_MODE === 'download') {
  await mkdir(join(OUT, 'media'), { recursive: true });
  await mkdir('.imgcache', { recursive: true });
  const q = [...mediaMap.entries()]; let ok = 0, fail = 0;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function worker() {
    while (q.length) {
      const [remote, local] = q.shift();
      const cacheFile = join('.imgcache', local.replace('/media/', ''));
      try { await access(cacheFile); } catch {
        let done = false;
        for (let i = 0; i < 5 && !done; i++) {
          try { const r = await fetch(remote, { headers: { 'user-agent': 'Mozilla/5.0 trinity-site-build' } });
            if (r.ok) { await writeFile(cacheFile, Buffer.from(await r.arrayBuffer())); done = true; }
            else if (r.status === 429) await sleep(5000 * (i + 1)); else { console.warn('media', r.status, remote); break; }
          } catch { await sleep(2000); }
        }
        if (!done) { fail++; continue; }
      }
      await cp(cacheFile, join(OUT, local.replace(/^\//, ''))); ok++;
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));
  console.log('media', ok, 'ok', fail, 'failed');
}
console.log('built', all.length, 'pages');
