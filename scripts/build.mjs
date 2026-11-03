// Trinity website v2 (Wix design, GitHub Pages + Supabase)
// content/v2/*  -> dist/
// IMG_MODE=download : download remote images/videos into dist/media (CI). Default: hotlink (local preview).
import { readFile, writeFile, mkdir, readdir, cp, rm, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { icon, productIcon } from './icons.mjs';
import { applyProductRevisions } from './revisions.mjs';

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
const BASE = (process.env.BASE_PATH ?? site.basePath ?? '').replace(/\/$/, '');

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
    if (!/\.(jpe?g|png|gif|webp|svg|mp4|pdf)$/i.test(name)) name += '.jpg';
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
  '/pages/travel-insurance-starr': '/shop/travel-insurance', '/pages/file-a-claim': '/claims', '/pages/client-portal': '/client-portal', '/pages/payments': '/payments'
};
const mapPath = h => {
  if (!h) return h;
  const [p, q] = h.split('#');
  if (OLD2NEW[p]) return OLD2NEW[p] + (q ? '#' + q : '');
  const m = p.match(/^\/blogs\/news\/(.+)$/); if (m) return '/blog/' + m[1];
  return h;
};
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
<style>html.locked body>*:not(#gate){display:none!important}#gate{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:#081f30;font-family:Inter,system-ui,sans-serif}#gate form{background:#fff;padding:36px 32px;border-radius:14px;width:min(360px,90vw);text-align:center;box-shadow:0 10px 40px rgba(0,0,0,.3)}#gate img{height:52px;margin:0 auto 18px}#gate p{margin:0 0 16px;color:#555;font-size:14px}#gate input{width:100%;padding:12px;border:1px solid #ccc;border-radius:6px;font:inherit;margin-bottom:12px;box-sizing:border-box}#gate button{width:100%;padding:12px;border:0;border-radius:6px;background:#006a7b;color:#fff;font:600 14px Inter,sans-serif;cursor:pointer}#gate .err{color:#c0392b;font-size:13px;min-height:18px;margin:8px 0 0}</style>
<script>(function(){var H="${site.gate.sha256}",K="trinity_gate";try{if(localStorage.getItem(K)===H)return}catch(e){}document.documentElement.classList.add("locked");document.addEventListener("DOMContentLoaded",function(){var d=document.createElement("div");d.id="gate";d.innerHTML='<form><img src="${esc(media(site.logo))}" alt="Trinity"><p>This preview site is password protected.</p><input type="password" placeholder="Password" autocomplete="current-password" required autofocus><button type="submit">Enter</button><p class="err" role="alert"></p></form>';document.body.appendChild(d);d.querySelector("form").addEventListener("submit",async function(e){e.preventDefault();var v=d.querySelector("input").value,b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v)),h=[].map.call(new Uint8Array(b),function(x){return x.toString(16).padStart(2,"0")}).join("");if(h===H){try{localStorage.setItem(K,H)}catch(e){}document.documentElement.classList.remove("locked");d.remove()}else{d.querySelector(".err").textContent="Incorrect password."}})})})();</script>` : '';

function layout({ path, title, description, image, body, bodyClass = '' }) {
  const full = path === '/' ? site.name : `${title} | Trinity Insurance Brokers`;
  const canonical = site.url + (path === '/' ? '/' : path);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(full)}</title>
<meta name="description" content="${esc(description || site.footer.about)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:title" content="${esc(full)}"><meta property="og:description" content="${esc(description || site.footer.about)}"><meta property="og:type" content="website"><meta property="og:url" content="${esc(canonical)}">${image ? `<meta property="og:image" content="${esc(image)}">` : ''}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:ital,wght@1,700;1,800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${url('/assets/site.css')}">
<link rel="icon" href="${url('/assets/favicon.png')}">
<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'InsuranceAgency', name: site.name, url: site.url, telephone: site.phone, email: site.email, address: { '@type': 'PostalAddress', streetAddress: '7504 Bagtikan St., San Antonio Village', addressLocality: 'Makati City', postalCode: '1203', addressCountry: 'PH' }, sameAs: SOCIAL.map(s => s.href) })}</script>
<script>window.SITE=${JSON.stringify({ base: BASE, supabase: site.supabase })};</script>
${gate()}
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
      <li><a href="${esc(site.footer.legal.find(l => /conduct/i.test(l.label)).href)}" target="_blank" rel="noopener">Code of Conduct</a></li></ul></div>
    <div><h3>Browse</h3><ul>
      <li><a href="${url('/solutions')}">Solutions</a></li><li><a href="${url('/blog')}">Blogs</a></li><li><a href="${url('/careers')}">Careers</a></li>
      <li><a href="${url('/contact-us')}">Contact Us</a></li><li><a href="${url('/site-map')}">Site Map</a></li></ul></div>
    <div class="f-social"><h3>Follow Us</h3><div class="social">${SOCIAL.map(s => `<a href="${s.href}" target="_blank" rel="noopener" aria-label="${s.label}">${icon(s.icon)}</a>`).join('')}</div>
      <p class="f-contact">${esc(site.phone)}<br><a href="mailto:${site.email}">${site.email}</a></p></div>
  </div>
  <div class="copyright">© ${new Date().getFullYear()} by ${esc(site.name)}</div>
</footer>
<a href="#" class="to-top" aria-label="Back to top">${icon('up')}</a>
<script src="${url('/assets/site.js')}" defer></script>
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
  all.push(path);
  searchIndex.push({ t: title, u: path, d: (opts.description || '').slice(0, 160) });
}

// ---------- shared sections ----------
const pageHero = (title, text = '', image = null, buttons = '') => `<section class="page-hero${image ? ' has-img' : ''}"${image ? ` style="--hero:url('${media(image)}')"` : ''}><div class="wrap"><h1>${esc(title)}</h1>${text ? `<p>${esc(text)}</p>` : ''}${buttons ? `<div class="btns">${buttons}</div>` : ''}</div></section>`;
const quickAccess = () => `<section class="quick"><div class="wrap"><h2>Quick Access Portal</h2><div class="quick-grid">${D.home.quickAccess.map(q => `<a class="quick-item" href="${url(q.href)}">${img(q.icon, '')}<span>${esc(q.label)}</span></a>`).join('')}</div></div></section>`;
const statsPartners = (heading = 'Our International Network Partners') => `<section class="trust"><div class="wrap"><h2>Trust &amp; Legacy</h2><div class="stats">${D.stats.map(s => `<div><strong>${esc(s.value)}</strong><span>${esc(s.label)}</span></div>`).join('')}</div><hr><h2>${esc(heading)}</h2><div class="partners">${D.partners.map(p => `<figure>${img(p.logo, p.name)}<figcaption>${esc(p.name)}</figcaption></figure>`).join('')}</div></div></section>`;
const whyChoose = () => `<section class="why"><div class="wrap"><h2>Why Choose Trinity?</h2><div class="why-grid">${D.why.map(w => `<div class="why-item">${img(w.icon, '')}<h3>${esc(w.title)}</h3><p>${esc(w.text)}</p></div>`).join('')}</div></div></section>`;
const ctaBand = () => `<section class="cta-band" style="--cta:url('${media(D.ctaImage)}')"><div class="wrap"><h2>We protect what matters most to you.</h2><p>Let's build a safer and more secure future together.</p><div class="btns">${btn('Get a Quote', '/contact-us', 'btn-orange')}${btn('Talk to Us', '/contact-us', 'btn-light')}</div></div></section>`;
const formSection = (kind, title = "Let's Talk", text = "Have questions or need expert guidance? Connect with our team today and let's find the right insurance solutions for your needs. We'll get back to you shortly.", subject = '') => `<section class="form-sec" id="inquire"><div class="wrap narrow"><h2>${esc(title)}</h2><p>${esc(text)}</p><div data-form="${kind}" data-subject="${esc(subject)}"></div></div></section>`;
const articleCards = list => `<div class="post-grid">${list.map(a => `<article class="post-card"><a href="${url('/blog/' + a.path.split('/').pop())}" class="thumb"${a.image ? ` style="background-image:url('${media(a.image)}')"` : ''} aria-label="${esc(a.title)}"></a><div class="post-info">${a.date ? `<time>${esc(fmtDate(a.date))}</time>` : ''}<h3><a href="${url('/blog/' + a.path.split('/').pop())}">${esc(a.title)}</a></h3></div></article>`).join('')}</div>`;

// ---------- HOME ----------
{
  const H = D.home;
  const body = `
<section class="home-hero"><div class="wrap hero-grid">
  <div class="hero-copy"><h1>${esc(H.heroTitle[0])} <span>${esc(H.heroTitle[1])}</span></h1><p>${esc(H.heroText)}</p><div class="btns">${btn('Get a Quote', '/contact-us')}${btn('Our Solutions', '/solutions', 'btn-orange')}</div></div>
  <div class="hero-media">${img(H.heroImage, 'The Trinity team')}</div>
</div></section>
<section class="banner40"><div class="wrap"><img src="${esc(media(H.banner40))}" alt="Trinity – 40 years of insurance and beyond" loading="eager"></div></section>
${quickAccess()}
<section class="solutions-bento"><div class="wrap"><h2>Trinity Insurance Solutions</h2>
  <div class="bento">
    <a class="bento-big" href="${url(H.bento[0].href)}" style="--bg:url('${media(H.bento[0].image)}')"><h3>${esc(H.bento[0].title)}</h3><p>${esc(H.bento[0].text)}</p><div class="bento-imgs">${H.bento[0].images.map(i => img(i, '')).join('')}</div></a>
    ${H.bento.slice(1).map(b => `<a class="bento-card" href="${url(b.href)}"><div><h3>${esc(b.title)}</h3><p>${esc(b.text)}</p></div>${img(b.image, '')}</a>`).join('')}
  </div>
  <div class="tiles">${H.tiles.map(t => `<a class="tile" href="${url(t.href)}" style="--bg:url('${media(t.image)}')"><span>${esc(t.title)}</span></a>`).join('')}</div>
</div></section>
<section class="featured"><div class="wrap"><h2>Featured Solutions</h2><div class="card-grid three">${H.featured.map(f => `<article class="card">${img(f.image, f.title)}<div class="card-body"><h3>${esc(f.title)}</h3><p>${esc(f.text)}</p>${btn('Learn More', f.href, 'btn-sm')}</div></article>`).join('')}</div></div></section>
${statsPartners()}
<section class="articles"><div class="wrap"><h2>Latest Articles</h2>${articleCards(posts.filter(p => p.blog === 'news').slice(0, 3))}<p class="tc">${btn('Explore Articles', '/blog')}</p></div></section>
<section class="promise"><div class="wrap"><h2>The Trinity Promise</h2><div class="promise-grid">${img(H.promiseImage, 'Trinity team meeting with a client', 'promise-img')}<div><h3>Our Story</h3><blockquote>“${esc(H.promiseQuote)}”</blockquote><p>${esc(site.footer.about)}</p></div></div></div></section>`;
  await page('/', 'Home', body, { description: 'Trinity Insurance and Reinsurance Brokers, Inc. – your partner in growing your business for 40 years: general insurance, employee benefits, and risk management solutions.', bodyClass: 'tpl-home' });
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
  await page('/about-us/corporate-profile', 'Corporate Profile', body, { description: 'Trinity Insurance and Reinsurance Brokers – chairman\'s message, history, milestones and core values.' });
}

// ---------- MEET THE TEAM ----------
{
  const person = p => `<article class="person">${p.photo ? img(p.photo, p.name) : `<div class="photo-ph" aria-hidden="true">${esc(p.name.split(' ').filter(w => /^[A-Z]/.test(w)).map(w => w[0]).slice(0, 2).join(''))}</div>`}<h3>${esc(p.name)}</h3><p class="role">${esc(p.role)}</p>${(p.creds || []).map(c => `<p class="cred">${esc(c)}</p>`).join('')}</article>`;
  const body = pageHero('Meet the Team') + `
<section class="team"><div class="wrap"><h2>Board of Directors</h2><div class="people">${D.board.map(person).join('')}</div></div></section>
<section class="leader-intro"><div class="wrap split">${img(D.home.promiseImage, 'Trinity leadership', 'rounded')}<div><h2>Our Leadership</h2><blockquote>“Guiding Trinity with decades of experience, innovation, and integrity.”</blockquote><p>Our leadership team drives our mission to deliver personalized, world-class risk management solutions.</p></div></div></section>
<section class="team"><div class="wrap"><h2>Leadership Team</h2><div class="people">${D.leadership.map(person).join('')}</div></div></section>`;
  await page('/about-us/meet-the-team', 'Meet the Team', body, { description: 'Board of Directors and Leadership Team of Trinity Insurance and Reinsurance Brokers, Inc.' });
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
  while ((m = re.exec(shHtml))) if (!/core values|why trinity|partners/i.test(m[1])) adv.push({ t: m[1].replace(/<[^>]+>/g, ''), d: m[2].replace(/<[^>]+>/g, '') });
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
<section class="ind-list"><div class="wrap"><h2>As a full-service brokerage firm, we serve a wide range of industries</h2><ul class="cols">${list.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div></section>
${statsPartners()}`;
  await page('/about-us/industries-we-serve', 'Industries We Serve', body, { description: 'Industries served by Trinity Insurance Brokers – automotive, aviation, construction, healthcare, logistics, real estate, retail, IT and more.' });
}

// ---------- CORPORATE GOVERNANCE (documents from the live site) ----------
{
  const sh = shop['/pages/corporate-governance'];
  const html = sh.sections.map(s => `<section class="sec legacy">${rewrite(s.html)}</section>`).join('').replace(/href="[^"]*\/pages\/www\./g, 'href="https://www.');
  const body = pageHero('Corporate Governance', 'Transparency, accountability and integrity.') + html + formSection('whistleblowing', 'Have concerns or want to report an issue?', 'Help us uphold transparency and integrity. All reports are treated with strict confidentiality. You may submit anonymously.');
  await page('/about-us/corporate-governance', 'Corporate Governance', body, { description: 'Corporate governance documents, scorecards and whistleblowing channel of Trinity Insurance and Reinsurance Brokers, Inc.', bodyClass: 'tpl-legacy' });
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
${Object.keys(CAT_META).map(cat => `<section class="cat-block"><div class="wrap"><h2><a href="${url('/solutions/' + cat)}">${CAT_META[cat].title}</a></h2>${productGrid(cat)}</div></section>`).join('')}
${whyChoose()}${ctaBand()}`;
  await page('/solutions', 'Solutions', body, { description: 'All Trinity insurance solutions: general insurance, employee benefits and service solutions.' });
  for (const cat of Object.keys(CAT_META)) {
    const c = categories[cat];
    const body = pageHero(CAT_META[cat].title, c.tagline || CAT_META[cat].tagline, c.heroImage, btn('Get a Quote', '/contact-us') + btn('Talk to Us', '/contact-us', 'btn-orange')) + `
<section class="featured"><div class="wrap"><h2>Featured Solutions</h2><div class="card-grid three">${c.featured.map(f => `<article class="card">${img(f.image, f.title)}<div class="card-body"><h3>${esc(f.title)}</h3><p>${esc(f.text)}</p>${btn('Learn More', f.href, 'btn-sm')}</div></article>`).join('')}</div></div></section>
<section class="cat-block"><div class="wrap"><h2>Explore Our Solutions</h2>${productGrid(cat)}</div></section>
${whyChoose()}${ctaBand()}`;
    await page('/solutions/' + cat, CAT_META[cat].title, body, { description: `${CAT_META[cat].title} from Trinity Insurance Brokers: ${productList(cat).map(prodTitle).join(', ')}.` });
  }
}

// ---------- PRODUCT PAGES ----------
const renderSection = s => {
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
  await page(p.path, title, body, { description: (intro[0] || '').slice(0, 158), image: p.heroImage });
}

// ---------- CLAIMS ----------
{
  const w = wix['/claims'].blocks;
  const sh = shop['/pages/claims'];
  const intro = w.find(b => b.t === 'p')?.text || '';
  const items = w.filter(b => b.t === 'li').map(b => b.text);
  const names = ['Motor Claims', 'Non-motor Claims', 'Property/Fire Claims', 'Marine and Cargo Hull Claims', 'HMO/Medical Claims', 'Travel Insurance Claims', 'Others'];
  const acc = items.map((t, i) => {
    const n = names.find(x => t.startsWith(x)) || t.split(/(?=[A-Z0-9])/)[0];
    let rest = t.slice(n.length).trim();
    rest = rest.replace(/\s*(\d+\.)\s/g, '\n$1 ').replace(/\s*[•●]\s*/g, '\n• ').replace(/\s+o\s+/g, '\n   ◦ ').replace(/​/g, '');
    return `<details${i === 0 ? ' open' : ''}><summary>${esc(n)}</summary><div class="acc-body">${rest.split('\n').filter(x => x.trim()).map(x => `<p>${esc(x.trim())}</p>`).join('')}</div></details>`;
  }).join('');
  const body = pageHero('Claims Assistance', intro) + `
<section class="claims"><div class="wrap"><h2>How Can We Help?</h2><p class="lead tc">Should you find yourself having to undergo any of these claims processes, you'll find that with us, your insurance claims will be handled with care and efficiency.</p><div class="accordion">${acc}</div></div></section>
${formSection('claim', 'Ready to File a Claim?', 'Our team is ready to guide you through the claims process quickly and efficiently. All information provided will remain private and secured.')}`;
  await page('/claims', 'Claims', body, { description: 'How to file motor, non-motor, property/fire, marine, HMO/medical and travel insurance claims with Trinity.' });
}

// ---------- CAREERS ----------
{
  const w = wix['/careers'].blocks;
  const sec = (h) => { const i = w.findIndex(b => b.t.startsWith('h') && b.text.toUpperCase() === h.toUpperCase()); const ps = []; for (let j = i + 1; j < w.length && (w[j].t === 'p' || w[j].t === 'img'); j++) if (w[j].t === 'p') ps.push(w[j].text); return ps; };
  const vals = ['EXCELLENCE', 'INTEGRITY', 'COLLABORATION', 'GROWTH'].map(v => ({ t: sentenceCase(v), d: sec(v)[0], img: w[w.findIndex(b => b.text === v) - 1]?.src }));
  const blocks = ['Challenging Career', 'Supportive Management', 'Meaningful Work'].map(h => ({ h, ps: sec(h) }));
  const testi = []; for (let i = 0; i < w.length; i++) if (w[i].t === 'h5') testi.push({ img: w[i - 1]?.t === 'img' ? w[i - 1].src : null, n: w[i].text, r: w[i + 1]?.text, q: w[i + 2]?.text });
  const life = w.slice(w.findIndex(b => /life at trinity/i.test(b.text || ''))).filter(b => b.t === 'img').slice(0, 4).map(b => b.src);
  // Current openings come from the live Shopify careers page (Trinity updates it monthly). October 2026: none.
  const shHtml = (shop['/pages/career']?.sections || []).map(s => s.html).join('');
  const openings = [...shHtml.matchAll(/<h4[^>]*>([^<]*(?:Specialist|Officer|Manager|Supervisor|Assistant|Head|Analyst)[^<]*)<\/h4>/g)].map(m => m[1]);
  const body = pageHero('Build Your Career. Make an Impact.', 'Be part of one of the leading independent insurance brokers in the country.', null, btn('Send Your Résumé', '#apply', 'btn-orange')) + `
<section class="intro"><div class="wrap split"><div><h2>Who We Are</h2><p>${esc(sec('WHO WE ARE')[0] || '')}</p></div>${img(w.find(b => b.t === 'img')?.src, '', 'rounded')}</div></section>
<section class="values"><div class="wrap"><div class="card-grid four">${vals.map(v => `<div class="value-card">${img(v.img, '')}<h3>${esc(v.t)}</h3><p>${esc(v.d)}</p></div>`).join('')}</div></div></section>
<section class="why-join"><div class="wrap"><h2>Why Join Trinity?</h2><p class="lead tc">${esc(sec('WHY JOIN TRINITY?')[0] || '')}</p>${blocks.map((b, i) => `<div class="split${i % 2 ? ' reverse' : ''}">${img(w.filter(x => x.t === 'img' && /webp/.test(x.src))[i]?.src, '', 'rounded')}<div><h3>${esc(b.h)}</h3>${b.ps.map(t => `<p>${esc(t)}</p>`).join('')}</div></div>`).join('')}</div></section>
<section class="testimonials"><div class="wrap"><h2>Hear From Our Team</h2><div class="card-grid three">${testi.map(t => `<figure class="testi">${img(t.img, t.n)}<blockquote>${esc(t.q)}</blockquote><figcaption><strong>${esc(t.n)}</strong><br>${esc(t.r)}</figcaption></figure>`).join('')}</div></div></section>
<section class="vacancies"><div class="wrap narrow"><h2>Job Vacancies</h2>${openings.length ? `<ul class="ticks">${openings.map(o => `<li>${esc(o)}</li>`).join('')}</ul>` : `<p class="lead tc">There are no open positions at the moment. You may still send us your updated profile and our HR team will keep it on file for future openings.</p>`}</div></section>
${formSection('career', 'Send Your Updated Profile!', 'Upon successful submission, our HR personnel will coordinate with you regarding the status of your application.').replace('id="inquire"', 'id="apply"')}
${life.length ? `<section class="life"><div class="wrap"><h2>Life at Trinity</h2><div class="gallery">${life.map(s => img(s, 'Life at Trinity')).join('')}</div></div></section>` : ''}`;
  await page('/careers', 'Careers', body, { description: 'Careers at Trinity Insurance and Reinsurance Brokers – why join us, life at Trinity, and how to apply.' });
}

// ---------- CONTACT ----------
{
  const body = pageHero('Contact Us', "We're here to help. Send us a message and our team will get back to you shortly.") + `
<section class="contact"><div class="wrap contact-grid">
  <div><h2>Send Us a Message</h2><p>Have a question or need assistance? Fill out the form and we'll respond as soon as possible.</p><div data-form="contact"></div></div>
  <div class="contact-info"><h2>Get in Touch</h2>
    <div class="ci">${icon('phone')}<div><strong>Call Us</strong><p><a href="tel:+63288101653">+632 8810 1653</a></p></div></div>
    <div class="ci">${icon('mail')}<div><strong>Email Us</strong><p><a href="mailto:${site.email}">${site.email}</a></p></div></div>
    <div class="ci">${icon('clock')}<div><strong>Office Hours</strong><p>Mon – Fri: 8:30 AM – 5:30 PM</p></div></div>
    <h3>Makati Head Office</h3><p>7504 Bagtikan St., San Antonio Village, Makati City, 1203 Metro Manila<br>Telephone: +632 8810 1653</p>
    <h3>Cebu Office</h3><p>Unit 610 The Meridian by Avenir, Golam Drive, Brgy. Kasambagan, 6000 Cebu City<br>Telephone: +632 887 4002</p>
  </div>
</div></section>
<section class="map"><iframe title="Trinity Makati Head Office map" loading="lazy" src="https://maps.google.com/maps?q=7504%20Bagtikan%20Street%20Makati&t=&z=15&ie=UTF8&iwloc=B&output=embed"></iframe></section>`;
  await page('/contact-us', 'Contact Us', body, { description: 'Contact Trinity Insurance Brokers – Makati head office and Cebu office, phone, email and inquiry form.' });
}

// ---------- CLIENT PORTAL / PAYMENTS ----------
await page('/client-portal', 'Client Portal', pageHero('Client Portal', 'Secure access to your policies, claims and payments.') + `
<section class="portal"><div class="wrap portal-grid">
  <form class="portal-login card" data-auth="login"><h2>Log In to Your Account</h2><p>Enter the email address registered with Trinity and we'll send you a secure login link.</p><input type="email" name="email" placeholder="Email address" required><button class="btn" type="submit">Send Login Link</button><p class="form-msg" role="status"></p></form>
  <div class="portal-links"><a class="quick-card" href="${url('/claims')}">${icon('claim')}<span>File a Claim</span></a><a class="quick-card" href="${url('/payments')}">${icon('card')}<span>Payments</span></a><a class="quick-card" href="${url('/contact-us')}">${icon('mail')}<span>Contact Your Account Officer</span></a></div>
</div></section>`, { description: 'Trinity client portal – log in to view policies, file claims and make payments.' });
await page('/payments', 'Payments', pageHero('Payments', 'Premium payment channels for Trinity clients.') + `<section class="sec"><div class="wrap narrow"><p class="lead">For payment instructions and official bank details, please contact your Trinity account officer or email <a href="mailto:${site.email}">${site.email}</a>. Always confirm payment details directly with Trinity before sending funds.</p></div></section>${formSection('payment', 'Payment Inquiry', 'Send us your policy details and our team will reply with the payment instructions.')}`, { description: 'Payment channels for Trinity Insurance Brokers clients.' });

// ---------- LEGAL PAGES (from the live site) ----------
for (const [old, path, title] of [['/pages/privacy-policy', '/privacy-policy', 'Privacy Policy'], ['/pages/terms-and-conditions', '/terms-and-conditions', 'Terms & Conditions'], ['/pages/disclaimer', '/disclaimer', 'Disclaimer'], ['/pages/cybersecurity', '/cybersecurity', 'Cybersecurity'], ['/pages/data-privacy-consent-form', '/data-privacy-consent-form', 'Data Privacy Consent Form']]) {
  const sh = shop[old]; if (!sh) continue;
  const body = pageHero(title) + `<section class="sec legacy"><div class="wrap narrow">${sh.sections.map(s => rewrite(s.html)).join('')}</div></section>`;
  await page(path, title, body, { description: sh.description, bodyClass: 'tpl-legacy' });
}

// ---------- BLOG ----------
const newsPosts = posts.filter(p => p.blog === 'news');
await page('/blog', 'Blog', pageHero('Trinity Blog', 'Health blasts, insurance insights and Trinity news.') + `<section class="sec blog-list"><div class="wrap"><div class="blog-tools"><input id="blog-q" type="search" class="search-input" placeholder="Search articles…" aria-label="Search articles"></div><div class="post-grid" data-paginate="12">${newsPosts.map(a => `<article class="post-card" data-title="${esc((a.title + ' ' + (a.tags || []).join(' ')).toLowerCase())}"><a href="${url('/blog/' + a.path.split('/').pop())}" class="thumb"${a.image ? ` style="background-image:url('${media(a.image)}')"` : ''} aria-label="${esc(a.title)}"></a><div class="post-info">${a.date ? `<time>${esc(fmtDate(a.date))}</time>` : ''}<h3><a href="${url('/blog/' + a.path.split('/').pop())}">${esc(a.title)}</a></h3></div></article>`).join('')}</div><p class="no-results" hidden>No articles match your search.</p><nav class="pager" aria-label="Pagination"></nav></div></section>`, { description: 'Trinity Insurance Brokers blog: health blasts, insurance explainers and company news.' });
for (let i = 0; i < newsPosts.length; i++) {
  const a = newsPosts[i], prev = newsPosts[i + 1], next = newsPosts[i - 1];
  const slug = '/blog/' + a.path.split('/').pop();
  const related = newsPosts.filter(x => x !== a && x.tags?.some(t => a.tags?.includes(t))).slice(0, 3);
  const body = `<section class="post-hero"><div class="wrap narrow"><p class="crumbs"><a href="${url('/blog')}">Blog</a></p><h1>${esc(a.title)}</h1>${a.date ? `<time>${esc(fmtDate(a.date))}</time>` : ''}</div></section>
<section class="article"><div class="wrap narrow">${a.image ? img(a.image, a.title, 'feature') : ''}<div class="rte">${rewrite(a.html)}</div>${a.tags?.length ? `<p class="tags">${a.tags.map(t => `<span>${esc(t)}</span>`).join('')}</p>` : ''}
<div class="post-nav">${prev ? `<a href="${url('/blog/' + prev.path.split('/').pop())}">← ${esc(prev.title)}</a>` : '<span></span>'}<a href="${url('/blog')}">All Articles</a>${next ? `<a href="${url('/blog/' + next.path.split('/').pop())}">${esc(next.title)} →</a>` : '<span></span>'}</div>
${related.length ? `<h2 class="tc">Related Articles</h2>${articleCards(related)}` : ''}</div></section>`;
  await emit(slug, layout({ path: slug, title: a.title, description: a.description, image: a.image, body, bodyClass: 'tpl-article' }));
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
    ['Shop', NAV[3].children], ['Help', [{ label: 'Claims', href: '/claims' }, { label: 'Careers', href: '/careers' }, { label: 'Client Portal', href: '/client-portal' }, { label: 'Payments', href: '/payments' }, { label: 'Contact Us', href: '/contact-us' }, { label: 'Blog', href: '/blog' }]],
    ['Legal', [{ label: 'Privacy Policy', href: '/privacy-policy' }, { label: 'Terms & Conditions', href: '/terms-and-conditions' }, { label: 'Disclaimer', href: '/disclaimer' }, { label: 'Cybersecurity', href: '/cybersecurity' }]]
  ];
  await page('/site-map', 'Site Map', pageHero('Site Map') + `<section class="sec"><div class="wrap sitemap">${groups.map(([g, l]) => `<div><h2>${esc(g)}</h2><ul>${l.map(x => `<li><a href="${url(x.href)}">${esc(x.label)}</a></li>`).join('')}</ul></div>`).join('')}</div></section>`, { description: 'Site map of the Trinity Insurance Brokers website.' });
}
await writeFile(join(OUT, '404.html'), layout({ path: '/404', title: 'Page not found', body: pageHero('Page not found', "Sorry, we couldn't find that page.", null, btn('Back to Home', '/')) }));

// ---------- redirects from old Shopify URLs ----------
const redirect = to => `<!doctype html><meta charset="utf-8"><title>Redirecting…</title><link rel="canonical" href="${site.url}${to}"><meta name="robots" content="noindex"><meta http-equiv="refresh" content="0; url=${url(to)}"><script>location.replace(${JSON.stringify(url(to))}+location.hash)</script><a href="${url(to)}">Continue</a>`;
const redirects = { ...OLD2NEW, '/pages/meet-our-cebu-team': '/about-us/meet-the-team', '/about-us/meet-our-cebu-team': '/about-us/meet-the-team', '/account': '/client-portal', '/account/login': '/client-portal', '/about-us': '/about-us/corporate-profile', '/shop': '/shop/travel-insurance', '/pages/whistleblowing-form': '/about-us/corporate-governance#inquire', '/cybersercurity': '/cybersecurity' };
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
await writeFile(join(OUT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${[...new Set(all)].filter(p => p !== '/search').map(p => `<url><loc>${site.url}${p}</loc></url>`).join('')}</urlset>`);
await writeFile(join(OUT, 'robots.txt'), site.gate?.enabled ? 'User-agent: *\nDisallow: /\n' : `User-agent: *\nAllow: /\nSitemap: ${site.url}/sitemap.xml\n`);
await writeFile(join(OUT, '.nojekyll'), '');
if (process.env.CNAME) await writeFile(join(OUT, 'CNAME'), process.env.CNAME);

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
