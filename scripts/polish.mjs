// Normalises migrated rich text (blog posts, legal pages, claims requirements) into clean, consistent markup:
// headings, check-mark lists, numbered steps, nested sub-lists, tip cards, tables and figures.
import { parseHTML } from 'linkedom';

const MARK = /^(?:(•|●|◦|▪|·|-|–|o|\*)|(\d{1,2})[.)]|([a-z])[.)])\s+(.*)$/s;
const NB = / |&nbsp;|&#160;/g;
const ZW = /[​‌‍﻿]/g;

const slug = t => t.toLowerCase().replace(/<[^>]+>/g, '').replace(/&[a-z#0-9]+;/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const plain = h => h.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&[a-z#0-9]+;/g, ' ').replace(/\s+/g, ' ').trim();
const isCaps = t => t.length > 3 && t === t.toUpperCase() && /[A-Z]{3}/.test(t);

// Turn one <br>-separated chunk into lines with indent + marker info.
function lines(html) {
  html = html
    .replace(/<\/(strong|b)>((?:\s|&nbsp;|&#160;|\u00a0)*)<(strong|b)>/gi, '$2')          // <b>1. </b><b>Title</b> → one bold run
    .replace(/<(strong|b)>\s*([•●▪])\s*<\/\1>/gi, '$2')                    // <strong>•</strong> text
    .replace(/((?:<br\s*\/?>\s*)+)<\/(strong|b)>/gi, '</$2>$1')               // <strong>Title<br><br></strong>Body
    .replace(/\s*([•●])\s*/g, '<br>$1 ');                                   // inline "• a • b" bullets
  return html.split(/<br\s*\/?>/i).flatMap(raw => {
    const sm = raw.replace(NB, ' ').trim().match(/^<(strong|b)>\s*(\d{1,2})[.)]\s+(.*?)<\/\1>\s*(\S.*)$/is);
    // "<strong>1. Title</strong>Body text" on one line → heading + body (only when the title is short)
    if (sm && plain(sm[3]).length < 90 && !/[;,]$/.test(plain(sm[3])) && plain(sm[4]).length > 20) return [`<strong>${sm[2]}. ${sm[3].replace(/[.:]\s*$/, '')}</strong>`, sm[4].replace(/^\s*:\s*/, '')];
    return [raw];
  }).map(raw => {
    const r = raw.replace(NB, ' ').replace(ZW, '');
    const lead = (r.replace(/<\/?(strong|b|em|i|span)[^>]*>/gi, '').match(/^\s*/) || [''])[0].length;
    let h = r.trim();
    // marker may sit inside <strong>: "<strong>  1. Medical</strong>"
    const inStrong = h.match(/^<(strong|b)>\s*(.*?)<\/\1>(.*)$/is);
    const probe = inStrong ? inStrong[2] : h;
    const m = plain(probe) ? probe.trim().match(MARK) : null;
    if (m && inStrong && !plain(inStrong[3]) && m[2] && plain(m[4]).length < 110) return { indent: lead, type: null, numHead: true, html: h };
    if (m) {
      const body = inStrong ? `<strong>${m[4]}</strong>${inStrong[3]}` : m[4];
      return { indent: lead, type: m[2] ? 'ol' : m[3] ? 'ol' : 'ul', marker: m[1] || (m[2] ? 'n' : 'a'), num: m[2] ? +m[2] : null, html: body.trim() };
    }
    return { indent: lead, type: null, html: h };
  }).filter(l => plain(l.html) || /<img/i.test(l.html));
}

// Build nested lists from marker lines.
function buildList(items) {
  const raw = [...new Set(items.map(i => i.indent))].sort((a, b) => a - b);
  const indents = []; for (const v of raw) if (!indents.length || v - indents[indents.length - 1][1] > 2) indents.push([v, v]); else indents[indents.length - 1][1] = v;
  const bucket = v => indents.findIndex(([a, b]) => v >= a && v <= b);
  const markers = [...new Set(items.map(i => i.marker))];
  const depth0 = it => indents.length > 1 ? Math.min(bucket(it.indent), 2) : Math.min(markers.indexOf(it.marker), 2);
  const min = Math.min(...items.map(depth0));
  const depthOf = it => depth0(it) - min;
  let out = '', stack = [];
  for (const it of items) {
    const d = depthOf(it);
    while (stack.length > d + 1) out += `</li></${stack.pop()}>`;
    if (stack.length === d + 1) out += '</li>';
    while (stack.length < d + 1) { const t = it.type || 'ul'; const st = !stack.length && t === 'ol' && it.num > 1 ? ` start="${it.num}" style="counter-reset:st ${it.num - 1}"` : ''; out += `<${t} class="${stack.length ? 'sublist' : t === 'ol' ? 'steps' : 'ticks'}"${st}>`; stack.push(t); }
    out += `<li>${it.html}`;
  }
  while (stack.length) out += `</li></${stack.pop()}>`;
  return out;
}

function headingFrom(h, level) {
  const t = plain(h);
  const n = t.match(/^(\d{1,2})[.)]\s+(.*)$/);
  if (n) return `<h${level} id="${slug(n[2])}"><span class="h-num">${n[1]}</span>${n[2]}</h${level}>`;
  return `<h${level} id="${slug(t)}">${t}</h${level}>`;
}

const pureStrong = h => /^<(strong|b)>[^]*<\/\1>\s*:?$/i.test(h.trim()) && !/<(strong|b)>[^]*<\/\1>[^]+<(strong|b)>/i.test(h.trim());

// Re-flow a paragraph's lines into headings / paragraphs / lists.
function flow(ls, level) {
  let out = '', buf = [], items = [];
  const flushP = () => { if (buf.length) { out += `<p>${buf.join('<br>')}</p>`; buf = []; } };
  const flushL = () => { if (items.length) { out += buildList(items); items = []; } };
  for (let i = 0; i < ls.length; i++) {
    const l = ls[i], nx = ls[i + 1];
    if (l.type === 'ol' && l.num && !items.length && nx && !nx.type && plain(l.html).length < 100 && !/[.;,]$/.test(plain(l.html))) {
      flushP(); const t = plain(l.html); out += `<h${level + 1} id="${slug(t)}"><span class="h-num">${l.num}</span>${t}</h${level + 1}>`; continue;
    }
    if (l.type) { flushP(); items.push(l); continue; }
    flushL();
    const t = plain(l.html);
    if (l.numHead) { flushP(); out += headingFrom(l.html, ls.length === 1 ? level : level + 1); continue; }
    if (pureStrong(l.html) && t.length < 120) {
      flushP();
      if (/:$/.test(t)) out += `<p class="lead-in"><strong>${t}</strong></p>`;
      else if (isCaps(t) && !/^\d/.test(t)) out += `<p class="eyebrow">${t}</p>`;
      else out += headingFrom(l.html, level);
    } else buf.push(l.html);
  }
  flushP(); flushL();
  return out;
}

export function polish(html, { level = 2, tips = true } = {}) {
  if (!html) return { html: '', toc: [] };
  html = html.replace(ZW, '').replace(/<o:p>.*?<\/o:p>/g, '');
  const { document } = parseHTML(`<!doctype html><html><body><div id="root">${html}</div></body></html>`);
  const root = document.getElementById('root');
  const unwrap = el => { while (el.firstChild) el.parentNode.insertBefore(el.firstChild, el); el.remove(); };

  root.querySelectorAll('script,style,meta,link').forEach(e => e.remove());
  root.querySelectorAll('font,span,article,section,center,u').forEach(unwrap);
  root.querySelectorAll('b').forEach(b => { const s = document.createElement('strong'); s.innerHTML = b.innerHTML; b.replaceWith(s); });
  root.querySelectorAll('h1').forEach(h => { const n = document.createElement('h2'); n.innerHTML = h.innerHTML; h.replaceWith(n); });
  root.querySelectorAll('h4,h5,h6').forEach(h => { const n = document.createElement('h3'); n.innerHTML = h.innerHTML; h.replaceWith(n); });
  root.querySelectorAll('*').forEach(el => { for (const a of [...el.attributes]) if (!['href', 'src', 'alt', 'colspan', 'rowspan', 'target', 'rel', 'start'].includes(a.name)) el.removeAttribute(a.name); });
  // divs: unwrap (layout leftovers), but keep their block boundaries
  root.querySelectorAll('div').forEach(d => { d.insertAdjacentHTML('beforebegin', '<br data-split>'); unwrap(d); });
  // stray inline content directly in root → wrap into paragraphs
  {
    let h = root.innerHTML.replace(/<br data-split="?"?>/g, '\n\n');
    root.innerHTML = h;
  }

  // Paragraphs and list items containing <br>-separated marker lines → real lists.
  for (const p of [...root.querySelectorAll('p')]) {
    const ls = lines(p.innerHTML);
    if (!ls.length) { if (!p.querySelector('img')) p.remove(); continue; }
    const hasMark = ls.some(l => l.type), multi = ls.length > 1;
    const firstStrong = pureStrong(ls[0].html) || ls.some(l => l.numHead);
    if (hasMark || (multi && firstStrong) || (ls.length === 1 && firstStrong)) p.outerHTML = flow(ls, level);
  }
  for (const li of [...root.querySelectorAll('li')]) {
    if (!/<br/i.test(li.innerHTML)) continue;
    const ls = lines(li.innerHTML);
    if (ls.some(l => l.type)) { const [head, ...rest] = ls; li.innerHTML = (head.type ? '' : head.html) + buildList(head.type ? ls : rest).replace(/class="(ticks|steps)"/, 'class="sublist"'); }
  }
  // Text "1. Something" written as separate paragraphs → ordered list.
  {
    const kids = [...root.children];
    for (let i = 0; i < kids.length; i++) {
      const run = [];
      while (kids[i] && kids[i].tagName === 'P') { const m = plain(kids[i].innerHTML).match(/^(?:(\d{1,2})[.)]|[•●▪])\s+/); if (!m || pureStrong(kids[i].innerHTML)) break; run.push(kids[i]); i++; }
      if (run.length >= 2) {
        const num = /^\d/.test(plain(run[0].innerHTML));
        const list = document.createElement(num ? 'ol' : 'ul'); const n0 = num ? +plain(run[0].innerHTML).match(/^(\d+)/)[1] : 1; if (n0 > 1) { list.setAttribute('start', n0); list.setAttribute('style', `counter-reset:st ${n0 - 1}`); }
        list.innerHTML = run.map(p => `<li>${p.innerHTML.replace(/^\s*(?:\d{1,2}[.)]|[•●▪])\s*/, '')}</li>`).join('');
        run[0].before(list); run.forEach(p => p.remove());
      }
    }
  }
  // Classes for real lists.
  root.querySelectorAll('ul').forEach(u => { if (!u.className) u.className = u.parentElement.closest('li') ? 'sublist' : 'ticks'; });
  root.querySelectorAll('ol').forEach(o => { if (!o.className) o.className = o.parentElement.closest('li') ? 'sublist' : 'steps'; });
  // Numbered sub-headings in one sequence share the same level
  { let last = null;
    for (const el of [...root.children]) {
      const hn = /^H[23]$/.test(el.tagName) && el.querySelector('.h-num');
      if (!hn) { if (/^H[12]$/.test(el.tagName)) last = null; continue; }
      const n = +hn.textContent;
      if (last && n === last.n + 1 && el.tagName !== last.tag) { const h = document.createElement(last.tag); h.innerHTML = el.innerHTML; h.id = el.id; el.replaceWith(h); }
      last = { n, tag: last && n === last.n + 1 ? last.tag : el.tagName };
    }
  }
  // Adjacent lists of the same kind (editor split them) → one list.
  for (const l of [...root.querySelectorAll('ul.ticks, ol.steps')]) {
    if (!l.isConnected) continue;
    let n = l.nextElementSibling;
    while (n && n.tagName === l.tagName && n.className === l.className) { while (n.firstChild) l.appendChild(n.firstChild); const r = n; n = n.nextElementSibling; r.remove(); }
  }
  { // single-item numbered lists whose item is a short title followed by text → numbered sub-headings; keep numbering running
    let count = 0;
    for (const el of [...root.children]) {
      if (/^H[12]$/.test(el.tagName)) { count = 0; continue; }
      if (el.tagName !== 'OL' || el.className !== 'steps') continue;
      const st = +el.getAttribute('start') || 0;
      if (el.children.length === 1 && plain(el.children[0].innerHTML).length < 100 && /^(P|UL)$/.test(el.nextElementSibling?.tagName || '') && !/[.;,]$/.test(plain(el.children[0].innerHTML))) {
        count = st || count + 1;
        const t = plain(el.children[0].innerHTML); const h = document.createElement('h3'); h.id = slug(t);
        h.innerHTML = `<span class="h-num">${count}</span>${t}`; el.replaceWith(h); continue;
      }
      const lis = [...el.children], lastT = plain(lis[lis.length - 1]?.innerHTML || '');
      if (lis.length > 1 && lastT.length < 100 && !/[.;,:]$/.test(lastT) && /^(P|UL)$/.test(el.nextElementSibling?.tagName || '')) {
        // mixed list that ends in a sub-heading → turn every item into a numbered sub-heading (+ its text)
        const frag = [];
        for (const li of lis) {
          count = count + 1;
          const lead = li.innerHTML.match(/^\s*<strong>(.*?)<\/strong>\s*:?\s*([\s\S]*)$/i);
          const t = plain(lead ? lead[1] : li.innerHTML), rest = lead ? lead[2] : '';
          if (!lead && t.length >= 100) { frag.push(`<p>${li.innerHTML}</p>`); continue; }
          frag.push(`<h3 id="${slug(t)}"><span class="h-num">${count}</span>${t}</h3>` + (plain(rest) ? `<p>${rest}</p>` : ''));
        }
        el.insertAdjacentHTML('beforebegin', frag.join('')); el.remove(); continue;
      }
      const start = st || (el.children.length === 1 && count ? count + 1 : 1);
      if (start > 1) { el.setAttribute('start', start); el.setAttribute('style', `counter-reset:st ${start - 1}`); }
      count = start + el.children.length - 1;
    }
  }
  // Tip pattern: single-item <ul> followed by explanatory paragraph(s) → numbered tip cards.
  if (tips) {
    const kids = [...root.children]; let i = 0;
    while (i < kids.length) {
      const grp = [];
      while (kids[i] && kids[i].tagName === 'UL' && kids[i].children.length === 1 && plain(kids[i].children[0].innerHTML).length < 120) {
        const it = { t: kids[i].children[0].innerHTML, ps: [], el: [kids[i]] }; i++;
        while (kids[i] && kids[i].tagName === 'P' && !(it.ps.length && /(:|following are[^.]*\.?)\s*$/i.test(plain(kids[i].innerHTML)))) { it.ps.push(kids[i].innerHTML); it.el.push(kids[i]); i++; }
        grp.push(it);
      }
      if (grp.length >= 2) {
        const ol = document.createElement('ol'); ol.className = 'tips';
        ol.innerHTML = grp.map(g => `<li><h3>${g.t}</h3>${g.ps.map(p => `<p>${p}</p>`).join('')}</li>`).join('');
        grp[0].el[0].before(ol); grp.flatMap(g => g.el).forEach(e => e.remove());
      }
      if (!grp.length) i++;
    }
  }
  root.querySelectorAll('h2,h3').forEach(h => h.querySelectorAll('strong').forEach(unwrap));
  root.querySelectorAll('ul,ol').forEach(l => { if (!l.children.length) l.remove(); });
  root.querySelectorAll('h2,h3').forEach(h => { if (!plain(h.innerHTML)) { if (h.querySelector('img')) { const f = document.createElement('figure'); f.innerHTML = [...h.querySelectorAll('img')].map(i => i.outerHTML).join(''); h.replaceWith(f); } else h.remove(); } });
  root.querySelectorAll('li').forEach(li => { if (!plain(li.innerHTML) && !li.querySelector('img,ul,ol')) li.remove(); });
  // Paragraph that is a short bold heading → heading (already done in flow for most); strip empty paragraphs.
  root.querySelectorAll('p').forEach(p => { if (!plain(p.innerHTML) && !p.querySelector('img')) p.remove(); });
  root.querySelectorAll('p').forEach(p => { if (/^\s*(<strong>)?\s*note\s*:/i.test(p.innerHTML)) p.className = 'note'; });
  // Images → figures; tables → scroll wrapper.
  root.querySelectorAll('p').forEach(p => { if (p.querySelector('img') && !plain(p.innerHTML)) { const f = document.createElement('figure'); f.innerHTML = [...p.querySelectorAll('img')].map(i => i.outerHTML).join(''); p.replaceWith(f); } });
  root.querySelectorAll('table').forEach(t => { const w = document.createElement('div'); w.className = 'table-wrap'; t.className = 'data'; t.before(w); w.appendChild(t); });
  // Lone byline "by Author" in italics.
  const first = root.querySelector('p');
  if (first && /^<em>\s*by\s/i.test(first.innerHTML.trim())) first.className = 'byline';
  // Headings get ids for the table of contents.
  let toc = [];
  root.querySelectorAll('h2,h3').forEach(h => { const t = plain(h.innerHTML).replace(/^\d{1,2}\s*/, ''); if (!h.id) h.id = slug(t); if (h.tagName === "H2" || level === 3) toc.push({ id: h.id, n: !!h.querySelector(".h-num"), t: plain(h.innerHTML.replace(/<span class="h-num">.*?<\/span>/, '')) }); });
  { // numbered documents: unnumbered h2s after the first numbered one are sub-sections
    const hs = [...root.querySelectorAll('h2')]; const fi = hs.findIndex(h => h.querySelector('.h-num'));
    if (fi >= 0) hs.slice(fi).forEach(h => { if (!h.querySelector('.h-num')) { const n = document.createElement('h3'); n.innerHTML = h.innerHTML; n.id = h.id; h.replaceWith(n); } });
  }
  [...root.children].forEach((p, i, arr) => {
    if (p.tagName !== 'P' || p.className || p.children.length || i === 0) return;
    const t = plain(p.innerHTML), nx = arr[i + 1];
    if (t.length < 3 || t.length > 70 || /[.!?:,;)]$/.test(t) || t.split(' ').length > 9 || !nx || !/^(H3|OL|UL)$/.test(nx.tagName)) return;
    const h = document.createElement('h2'); h.textContent = t; h.id = slug(t); p.replaceWith(h);
  });
  // Short sub-topics introduced by "…include:" → compact cards (Observation / Bracing / Surgery …)
  for (const li of [...root.querySelectorAll('p.lead-in')]) {
    let h = li.nextElementSibling; const cards = [];
    while (h && /^H[23]$/.test(h.tagName) && !/\?\s*$/.test(plain(h.innerHTML))) {
      const body = []; let n = h.nextElementSibling;
      while (n && !/^H[23]$/.test(n.tagName) && !(n.tagName === 'P' && n.className === 'lead-in')) { body.push(n); n = n.nextElementSibling; }
      if (body.length > 2 || body.some(b => b.tagName !== 'P')) break;
      cards.push({ h, body }); h = n;
    }
    if (cards.length >= 2) {
      const d = document.createElement('div'); d.className = 'sub-cards';
      d.innerHTML = cards.map(c => `<div class="sub-card"><h3>${c.h.innerHTML}</h3>${c.body.map(b => b.outerHTML).join('')}</div>`).join('');
      cards[0].h.before(d); cards.forEach(c => { c.h.remove(); c.body.forEach(b => b.remove()); });
    }
  }
  // Reference / source lists
  root.querySelectorAll('p').forEach(p => { if (/^(references?|sources?)\s*:?\s*$/i.test(plain(p.innerHTML))) { p.className = 'ref-head'; const n = p.nextElementSibling; if (n && /^(UL|OL)$/.test(n.tagName)) n.className = 'sources'; } });
  toc = toc.filter(t => { const h = root.querySelector(`[id="${t.id}"]`); return h && !h.closest('.sub-cards') && (h.tagName === 'H2' || level === 3); });
  // consecutive figures → a row
  root.querySelectorAll('figure').forEach(f => { if (f.parentElement.classList?.contains('fig-row')) return; const run = [f]; let n = f.nextElementSibling; while (n && n.tagName === 'FIGURE') { run.push(n); n = n.nextElementSibling; } if (run.length > 1) { const d = document.createElement('div'); d.className = 'fig-row'; f.before(d); run.forEach(x => d.appendChild(x)); } });
  let out = root.innerHTML.replace(NB, ' ').replace(/(<br>\s*){2,}/g, '<br>').replace(/<p>\s*<br>/g, '<p>').replace(/<br>\s*<\/p>/g, '</p>').replace(/<strong>\s*<\/strong>/g, '');
  // bare text left at root level → paragraphs
  out = out.replace(/(^|<\/(?:p|ul|ol|h2|h3|figure|div|hr|table)>)\s*([^<\s][^<]*?)\s*(?=<(?:p|ul|ol|h2|h3|figure|div|hr|table)\b|$)/g, (m, a, t) => `${a}<p>${t}</p>`);
  return { html: out, toc };
}

export const readingTime = html => Math.max(1, Math.round(plain(html).split(' ').length / 220));
