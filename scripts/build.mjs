// Build static site: content/ -> dist/
// IMG_MODE=download  : download remote Shopify images into dist/img (used in CI)
// default            : keep remote image URLs (local preview)
import { readFile, writeFile, mkdir, readdir, cp, rm, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';

const OUT = 'dist';
const IMG_MODE = process.env.IMG_MODE || 'remote';
const site = JSON.parse(await readFile('content/site.json', 'utf8'));
// basePath: "/trinity-website" while served from github.io project pages; set to "" once the custom domain points here
const BASE_PATH = (process.env.BASE_PATH ?? site.basePath ?? '').replace(/\/$/, '');
const posts = JSON.parse(await readFile('content/posts.json', 'utf8'));
const pages = [];
for (const f of await readdir('content/pages')) if (f.endsWith('.json')) pages.push(JSON.parse(await readFile(join('content/pages', f), 'utf8')));

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
await cp('assets', join(OUT, 'assets'), { recursive: true });

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const url = p => {
  if (!p || /^(https?:|mailto:|tel:|#|data:)/.test(p)) return p;
  if (BASE_PATH && (p === BASE_PATH || p.startsWith(BASE_PATH + '/'))) return p;
  return BASE_PATH + p;
};

// ---------- images ----------
const imgMap = new Map();
const isRemoteImg = u => /^https:\/\/(trinity-insures\.com\/cdn\/|cdn\.shopify\.com\/)/.test(u) && /\.(jpe?g|png|gif|webp|svg)(\?|$)/i.test(u);
function localImg(u) {
  if (IMG_MODE !== 'download' || !isRemoteImg(u)) return u;
  if (!imgMap.has(u)) {
    const clean = u.split('?')[0];
    const name = clean.split('/').pop().replace(/[^a-zA-Z0-9._-]/g, '_');
    const h = createHash('md5').update(u).digest('hex').slice(0, 6);
    imgMap.set(u, `/img/${h}-${name}`);
  }
  return url(imgMap.get(u));
}
const rewrite = html => String(html || '')
  .replace(/(src|href)="([^"]+)"/g, (m, a, v) => {
    const d = v.replace(/&amp;/g, '&');
    if (a === 'src' || isRemoteImg(d)) return `${a}="${esc(localImg(d))}"`;
    return `${a}="${esc(url(d))}"`;
  })
  .replace(/url\('([^']+)'\)/g, (m, v) => `url('${localImg(v.replace(/&amp;/g, '&'))}')`)
  .replace(/<img /g, '<img loading="lazy" ');

// ---------- layout ----------
const navHtml = (items, cur) => items.map(it => it.children
  ? `<li class="has-sub"><a href="#" class="nav-parent" aria-haspopup="true">${esc(it.label)} <span class="caret">▾</span></a><ul class="sub">${it.children.map(c => `<li><a href="${url(c.href)}"${c.href === cur ? ' aria-current="page"' : ''}>${esc(c.label)}</a></li>`).join('')}</ul></li>`
  : `<li><a href="${url(it.href)}"${it.href === cur ? ' aria-current="page"' : ''}>${esc(it.label)}</a></li>`).join('');

function layout({ path, title, description, image, body, bodyClass = '' }) {
  const fullTitle = path === '/' ? site.name : `${title} – ${site.name}`;
  const canonical = site.url + path;
  const ogImg = image ? (image.startsWith('http') ? image : site.url + image) : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description || site.footer.about)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(description || site.footer.about)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${esc(canonical)}">
${ogImg ? `<meta property="og:image" content="${esc(ogImg)}">` : ''}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${url('/assets/site.css')}">
<link rel="icon" href="${url('/assets/favicon.png')}">
<script>window.SITE=${JSON.stringify({ base: BASE_PATH, supabase: site.supabase })};</script>
</head>
<body class="${bodyClass}">
<a class="skip" href="#main">Skip to content</a>
<div class="topbar"><div class="wrap"><span>${esc(site.address)}</span><span class="social">${site.social.map(s => `<a href="${s.href}" target="_blank" rel="noopener">${s.label}</a>`).join(' | ')}</span></div></div>
<header class="site-header">
  <div class="wrap header-row">
    <button class="menu-toggle" aria-label="Open menu" aria-expanded="false">☰</button>
    <a class="logo" href="${url('/')}"><img src="${esc(localImg(site.logo))}" alt="${esc(site.name)}" width="200" height="58"></a>
    <div class="header-icons">
      <a href="${url('/search')}" aria-label="Search"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg></a>
      <a href="${url('/pages/client-portal')}" aria-label="Client portal"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg></a>
    </div>
  </div>
  <nav class="main-nav" aria-label="Main"><ul class="wrap">${navHtml(site.nav, path)}</ul></nav>
</header>
<main id="main">
${body}
</main>
<footer class="site-footer">
  <div class="wrap footer-grid">
    <div class="f-about">
      <a href="${url('/')}"><img src="${esc(localImg(site.logoInverse))}" alt="${esc(site.name)}" width="220"></a>
      <p>${esc(site.footer.about)}</p>
      <p class="legal">${site.footer.legal.map(l => `<a href="${esc(url(l.href))}">${esc(l.label)}</a>`).join(' | ')}</p>
    </div>
    ${site.footer.columns.map(c => `<div><h3>${esc(c.title)}</h3><ul>${c.links.map(l => `<li><a href="${esc(url(l.href))}">${esc(l.label)}</a></li>`).join('')}</ul></div>`).join('')}
  </div>
  <div class="copyright">Copyright © ${new Date().getFullYear()}, ${esc(site.name)}</div>
</footer>
<a href="#" class="to-top" aria-label="Back to top">↑</a>
<script src="${url('/assets/site.js')}" defer></script>
</body>
</html>`;
}

const hero = (title, image, sub = '') => `<section class="page-head${image ? ' has-img' : ''}"${image ? ` style="background-image:url('${localImg(image)}')"` : ''}><div class="wrap"><h1>${esc(title)}</h1>${sub}</div></section>`;
const sectionsHtml = secs => secs.map(s => `<section class="sec ${s.type}">${rewrite(s.html)}</section>`).join('\n');
const fmtDate = d => { const t = new Date(String(d).replace(/ ([+-]\d{2})(\d{2})$/, '$1:$2').replace(' ', 'T')); return isNaN(t) ? d : t.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }); };

async function emit(path, html) {
  const file = path === '/' ? join(OUT, 'index.html') : join(OUT, path.replace(/^\//, ''), 'index.html');
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, html);
}

// ---------- pages ----------
const card = a => `<article class="post-card"><a href="${url(a.path)}" class="thumb"${a.image ? ` style="background-image:url('${localImg(a.image)}')"` : ''}></a><div class="post-info"><h4><a href="${url(a.path)}">${esc(a.title)}</a></h4>${a.date ? `<time>${esc(fmtDate(a.date))}</time>` : ''}</div></article>`;

const searchIndex = [];
for (const p of pages) {
  if (p.path.startsWith('/collections/')) continue; // Shopify-only listings
  let body;
  if (p.template === 'product') {
    body = hero(p.product.title, null) + `<section class="sec product"><div class="container"><div class="row">
      <div class="col-12 col-md-6">${p.product.image ? `<img src="${esc(localImg(p.product.image))}" alt="${esc(p.product.title)}">` : ''}</div>
      <div class="col-12 col-md-6"><h2>${esc(p.product.title)}</h2><div class="rte">${rewrite(p.product.html)}</div>
      <h3>Inquire about this plan</h3><div data-form="inquiry" data-kind="product" data-subject="${esc(p.product.title)}"></div></div>
    </div></div></section>`;
  } else {
    const h = p.template === 'home' || !p.hero ? '' : hero(p.hero.title || p.title, p.hero.image);
    body = h + sectionsHtml(p.sections.map(s => s.type === 'type_featured_blog'
      ? { ...s, html: `<div class="container"><h3 class="tc">ARTICLES</h3><div class="post-grid three">${posts.slice(0, 3).map(card).join('')}</div><p class="tc" style="margin-top:30px"><a class="btn btn-outline" href="/blogs/news">View All</a></p></div>` }
      : s));
  }
  await emit(p.path, layout({ path: p.path, title: p.title, description: p.description, image: p.hero?.image || p.product?.image, body, bodyClass: 'tpl-' + p.template }));
  searchIndex.push({ t: p.product?.title || p.hero?.title || p.title, u: p.path, d: (p.description || '').slice(0, 160) });
}

// ---------- blog ----------
await emit('/blogs/news', layout({ path: '/blogs/news', title: 'News', description: 'News, health blasts and insurance insights from Trinity Insurance Brokers.',
  body: hero('News', null) + `<section class="sec blog-list"><div class="container"><div class="post-grid" data-paginate="12">${posts.filter(p => p.blog === 'news').map(card).join('')}</div><nav class="pager" aria-label="Pagination"></nav></div></section>` }));
for (let i = 0; i < posts.length; i++) {
  const a = posts[i], prev = posts[i + 1], next = posts[i - 1];
  const related = posts.filter(x => x !== a && x.tags?.some(t => a.tags?.includes(t))).slice(0, 3);
  const body = hero(a.title, null, a.date ? `<time class="date">${esc(fmtDate(a.date))}</time>` : '') +
    `<section class="sec article"><div class="container narrow">${a.image ? `<img class="feature" src="${esc(localImg(a.image))}" alt="">` : ''}<div class="rte">${rewrite(a.html)}</div>
    ${a.tags?.length ? `<p class="tags">${a.tags.map(t => `<span>${esc(t)}</span>`).join('')}</p>` : ''}
    <div class="post-nav">${prev ? `<a href="${url(prev.path)}">← ${esc(prev.title)}</a>` : '<span></span>'}<a href="${url('/blogs/' + a.blog)}">Back to News</a>${next ? `<a href="${url(next.path)}">${esc(next.title)} →</a>` : '<span></span>'}</div>
    ${related.length ? `<h4 class="tc related-h">Related Articles</h4><div class="post-grid">${related.map(card).join('')}</div>` : ''}
    </div></section>`;
  await emit(a.path, layout({ path: a.path, title: a.title, description: a.description, image: a.image, body, bodyClass: 'tpl-article' }));
  searchIndex.push({ t: a.title, u: a.path, d: (a.excerpt || '').slice(0, 160) });
}

// ---------- new / utility pages ----------
await emit('/pages/client-portal', layout({ path: '/pages/client-portal', title: 'Client Portal', description: 'Trinity client portal – view policies, file claims and make payments.',
  body: hero('Client Portal', null) + `<section class="sec"><div class="container narrow tc"><h3>Login Your Account</h3><p>The new Trinity client portal is being set up. In the meantime you can file a claim or reach your account officer directly.</p>
  <form class="portal-login" data-auth="login"><input type="email" name="email" placeholder="Email address" required><button class="btn" type="submit">Send me a login link</button><p class="form-msg" role="status"></p></form>
  <p><a class="btn btn-outline" href="${url('/pages/file-a-claim')}">File a Claim</a> <a class="btn btn-outline" href="${url('/pages/payments')}">Payments</a></p></div></section>` }));
await emit('/pages/payments', layout({ path: '/pages/payments', title: 'Payments', description: 'Payment channels for Trinity Insurance Brokers clients.',
  body: hero('Payments', null) + `<section class="sec"><div class="container narrow"><p>Payment channels for policy premiums will be listed here. For payment instructions, please contact your Trinity account officer or email <a href="mailto:${site.email}">${site.email}</a>.</p><div data-form="inquiry" data-kind="payment" data-subject="Payment inquiry"></div></div></section>` }));
await emit('/search', layout({ path: '/search', title: 'Search', description: 'Search the Trinity Insurance Brokers website.',
  body: hero('Search', null) + `<section class="sec"><div class="container narrow"><input id="q" class="search-input" type="search" placeholder="Search insurance solutions, articles…" autofocus><ul id="results" class="search-results"></ul></div></section>` }));
await writeFile(join(OUT, 'search.json'), JSON.stringify(searchIndex));
await writeFile(join(OUT, '404.html'), layout({ path: '/404', title: 'Page not found', body: hero('Page not found', null) + `<section class="sec"><div class="container tc"><p>Sorry, we couldn't find that page.</p><p><a class="btn" href="${url('/')}">Back to home</a></p></div></section>` }));

// ---------- sitemap / robots ----------
const all = [...pages.filter(p => !p.path.startsWith('/collections/')).map(p => p.path), ...posts.map(p => p.path), '/blogs/news', '/pages/client-portal', '/pages/payments'];
await writeFile(join(OUT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${[...new Set(all)].map(p => `<url><loc>${site.url}${p}</loc></url>`).join('')}</urlset>`);
await writeFile(join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${site.url}/sitemap.xml\n`);
await writeFile(join(OUT, '.nojekyll'), '');
if (process.env.CNAME) await writeFile(join(OUT, 'CNAME'), process.env.CNAME);

// ---------- download images (CI) ----------
if (IMG_MODE === 'download') {
  await mkdir(join(OUT, 'img'), { recursive: true });
  await mkdir('.imgcache', { recursive: true });
  const list = [...imgMap.entries()];
  let ok = 0, fail = 0;
  const q = [...list];
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function worker() {
    while (q.length) {
      const [remote, local] = q.shift();
      const cacheFile = join('.imgcache', local.replace('/img/', ''));
      try { await access(cacheFile); } catch {
        let done = false;
        for (let i = 0; i < 5 && !done; i++) {
          try {
            const r = await fetch(remote, { headers: { 'user-agent': 'Mozilla/5.0 trinity-site-build' } });
            if (r.ok) { await writeFile(cacheFile, Buffer.from(await r.arrayBuffer())); done = true; }
            else if (r.status === 429) await sleep(5000 * (i + 1));
            else break;
          } catch { await sleep(2000); }
        }
        if (!done) { fail++; console.warn('img fail', remote); continue; }
      }
      await cp(cacheFile, join(OUT, local.replace(/^\//, '')));
      ok++;
    }
  }
  await Promise.all(Array.from({ length: 3 }, worker));
  console.log('images', ok, 'ok', fail, 'failed');
}
console.log('built', pages.length, 'pages,', posts.length, 'posts');
