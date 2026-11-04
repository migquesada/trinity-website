// Editorial enhancements for blog posts (all extractive – nothing is invented):
// standfirst, key takeaways, pull quotes, FAQ pairs for structured data, category, word count.
import { parseHTML } from 'linkedom';

const plain = h => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&[a-z#0-9]+;/g, ' ').replace(/\s+/g, ' ').trim();
const sentences = t => (t.match(/[^.!?]+[.!?]+(?=\s|$)/g) || []).map(s => s.trim());

export function category(post) {
  const t = post.title.toLowerCase();
  if (/insurance|risk|cyber|liability|bond|policy|claim|broker|cargo|marine|underinsur|market|loss prevention/.test(t)) return 'Insurance Insights';
  const s = (post.title + ' ' + (post.tags || []).join(' ')).toLowerCase();
  if (/health blast|hmo|health|wellness|medical|disease|sleep|mental|food|exercise|virus|covid|diet|heart|eye|skin|rabies|dengue/.test(s)) return 'Health & Wellness';
  if (/insurance|risk|cyber|liability|bond|policy|claim|broker|market|cargo|marine|property|fire|motor|loss prevention|audit|credit|livestock|director/.test(s)) return 'Insurance Insights';
  return 'Trinity News';
}

const GOOD = /\b(important|key|best|can help|helps|should|protect|prevent|risk|early|regular|essential|remember|safe|healthy|better|matters?)\b/i;
const BAD = /^(this|it|they|these|those|that|he|she|there|here|however|also|and|but|so|for example|e\.g\.|thus|though|nonetheless|therefore|moreover|furthermore|in this|read|click|visit|lastly|finally|first|second|third)\b|\barticle\b|\bblog\b|\bwe\b|\bour\b|\s\d+\s*\.$|\b(below|above)\b/i;

export function enhance(html, title) {
  const out = { html, standfirst: '', takeaways: [], quotes: [], faq: [], words: 0 };
  if (!html || plain(html).length < 200) { out.words = plain(html).split(' ').filter(Boolean).length; return out; }
  const { document } = parseHTML(`<!doctype html><html><body><div id="r">${html}</div></body></html>`);
  const r = document.getElementById('r');
  const kids = [...r.children];
  out.words = plain(r.innerHTML).split(' ').length;

  // Standfirst: first real paragraph before the first heading.
  const first = kids.find(k => k.tagName === 'P' && !k.className && plain(k.innerHTML).length > 60);
  if (first && kids.indexOf(first) < 3) { first.className = 'standfirst'; out.standfirst = plain(first.innerHTML); }

  // Sections by h2.
  const secs = []; let cur = null;
  for (const k of kids) {
    if (k.tagName === 'H2') { cur = { h: k, els: [] }; secs.push(cur); }
    else if (cur) cur.els.push(k);
  }
  // Key takeaways: the opening sentence of each section (max 5), only when there are 3+ sections.
  if (secs.length >= 3) {
    out.takeaways = secs.map(s => {
      const p = s.els.find(e => e.tagName === 'P' && plain(e.innerHTML).length > 40);
      const sn = p ? sentences(plain(p.innerHTML))[0] : '';
      return sn && sn.length < 220 ? sn : '';
    }).filter(Boolean).slice(0, 5);
    if (out.takeaways.length < 3) out.takeaways = [];
  }
  // FAQ pairs: question headings + the first paragraph that follows.
  for (const s of secs) {
    const q = plain(s.h.innerHTML);
    if (!/\?$/.test(q)) continue;
    const ans = s.els.filter(e => e.tagName === 'P').slice(0, 2).map(e => plain(e.innerHTML)).join(' ');
    const list = s.els.find(e => /^(UL|OL)$/.test(e.tagName));
    const extra = list ? ' ' + [...list.children].map(li => plain(li.innerHTML)).slice(0, 8).join('; ') + '.' : '';
    if (ans.length > 40) out.faq.push({ q, a: (ans + extra).slice(0, 900) });
  }
  // Pull quotes: up to two strong sentences from the body (not the standfirst), placed mid-article.
  const used = new Set(out.takeaways);
  const cands = [];
  kids.forEach((k, i) => {
    if (k.tagName !== 'P' || k.className || i < 2) return;
    const ss = sentences(plain(k.innerHTML)); if (ss.length < 2) return;
    for (const s of ss) {
      if (s.length < 70 || s.length > 190 || BAD.test(s) || /[?:]|https?:|\(|\d{3,}/.test(s) || used.has(s)) continue;
      cands.push({ s, i, score: (GOOD.test(s) ? 2 : 0) + (s.length > 90 && s.length < 160 ? 1 : 0) });
    }
  });
  cands.sort((a, b) => b.score - a.score || a.i - b.i);
  const picks = [];
  for (const c of cands) { if (picks.length >= (out.words > 900 ? 2 : 1)) break; if (picks.every(p => Math.abs(p.i - c.i) > 4)) picks.push(c); }
  picks.sort((a, b) => b.i - a.i).forEach(p => {
    // place the quote a little further on (before the next heading), never right under its own paragraph
    let j = p.i + 1; while (j < kids.length && j < p.i + 6 && !/^H[23]$/.test(kids[j].tagName)) j++;
    const before = kids[j] && /^H[23]$/.test(kids[j].tagName) && j > p.i + 1 ? kids[j] : null;
    const anchor = before ? null : (kids[Math.min(p.i + 2, kids.length - 1)]);
    const bq = document.createElement('figure'); bq.className = 'pull-quote';
    bq.innerHTML = `<blockquote><p>${p.s.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p></blockquote>`;
    if (before) before.before(bq); else anchor.after(bq); out.quotes.push(p.s);
  });
  // Native blockquotes in the source get the same treatment.
  r.querySelectorAll('blockquote').forEach(b => { if (!b.closest('.pull-quote')) b.classList.add('quote'); });
  out.html = r.innerHTML;
  return out;
}
