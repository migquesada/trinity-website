// Trinity site behaviour: nav, back-to-top, blog pagination, search, Supabase-backed forms.
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const SB = (window.SITE && window.SITE.supabase) || {};
  const base = (window.SITE && window.SITE.base) || '';

  // mobile menu + dropdowns
  const toggle = $('.menu-toggle'), nav = $('.main-nav');
  toggle && toggle.addEventListener('click', () => { const o = nav.classList.toggle('open'); toggle.setAttribute('aria-expanded', o); });
  $$('.nav-parent').forEach(a => a.addEventListener('click', e => { e.preventDefault(); a.parentElement.classList.toggle('open'); }));

  // back to top
  const top = $('.to-top');
  addEventListener('scroll', () => top && top.classList.toggle('show', scrollY > 500), { passive: true });
  top && top.addEventListener('click', e => { e.preventDefault(); scrollTo({ top: 0, behavior: 'smooth' }); });

  // blog pagination (client side)
  $$('[data-paginate]').forEach(grid => {
    const per = +grid.dataset.paginate, cards = $$('.post-card', grid), pager = grid.parentElement.querySelector('.pager');
    const pages = Math.ceil(cards.length / per);
    const show = n => {
      cards.forEach((c, i) => c.hidden = i < (n - 1) * per || i >= n * per);
      pager.innerHTML = pages < 2 ? '' : Array.from({ length: pages }, (_, i) => `<button ${i + 1 === n ? 'aria-current="page"' : ''} data-p="${i + 1}">${i + 1}</button>`).join('');
      history.replaceState(null, '', n > 1 ? '?page=' + n : location.pathname);
    };
    pager.addEventListener('click', e => { const b = e.target.closest('button'); if (b) { show(+b.dataset.p); grid.scrollIntoView({ behavior: 'smooth' }); } });
    show(Math.min(pages, +(new URLSearchParams(location.search).get('page')) || 1));
  });

  // search
  const q = $('#q');
  if (q) {
    let idx = [];
    fetch(base + '/search.json').then(r => r.json()).then(d => { idx = d; run(); });
    const run = () => {
      const v = q.value.trim().toLowerCase(), out = $('#results');
      if (!v) { out.innerHTML = ''; return; }
      const hits = idx.filter(x => (x.t + ' ' + x.d).toLowerCase().includes(v)).slice(0, 40);
      out.innerHTML = hits.length ? hits.map(h => `<li><a href="${base + h.u}">${h.t}</a><p>${h.d}</p></li>`).join('') : '<li>No results.</li>';
    };
    q.value = new URLSearchParams(location.search).get('q') || '';
    q.addEventListener('input', run);
  }

  // Supabase REST insert (anon key, RLS: insert-only)
  async function sbInsert(table, row) {
    if (!SB.url || !SB.anonKey) throw new Error('Forms are not connected yet.');
    const r = await fetch(`${SB.url}/rest/v1/${table}`, {
      method: 'POST',
      headers: { apikey: SB.anonKey, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(row)
    });
    if (!r.ok) throw new Error('Submission failed (' + r.status + ')');
  }

  // inquiry forms (replace Shopify form-builder placeholders)
  $$('[data-form="inquiry"]').forEach(el => {
    const kind = el.dataset.kind || (location.pathname.includes('claim') ? 'claim' : location.pathname.includes('career') ? 'career' : 'inquiry');
    el.innerHTML = `<form class="tform">
      <input name="name" placeholder="Full name *" required>
      <input name="email" type="email" placeholder="Email *" required>
      <input name="phone" placeholder="Phone">
      <input name="company" placeholder="Company">
      <input class="full" name="subject" placeholder="Subject" value="${el.dataset.subject || document.title.split(' – ')[0]}">
      <textarea class="full" name="message" placeholder="Message *" required></textarea>
      <label class="full" style="font-size:13px"><input type="checkbox" required style="width:auto"> I agree to the <a href="${base}/pages/privacy-policy">Privacy Policy</a> and the processing of my data.</label>
      <div class="full"><button class="btn" type="submit">Submit</button><p class="form-msg" role="status"></p></div></form>`;
    const f = $('form', el), msg = $('.form-msg', el);
    f.addEventListener('submit', async e => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(f));
      msg.className = 'form-msg'; msg.textContent = 'Sending…';
      try {
        await sbInsert('inquiries', { kind, name: d.name, email: d.email, phone: d.phone, company: d.company, subject: d.subject, message: d.message, page: location.pathname });
        f.reset(); msg.className = 'form-msg ok'; msg.textContent = 'Thank you! Our team will get back to you shortly.';
      } catch (err) { msg.className = 'form-msg err'; msg.textContent = err.message + ' Please email trinity@trinity-insures.com.'; }
    });
  });

  // newsletter
  $$('.type_newsletter .container, .type_newsletter > div').slice(0, 1).forEach(box => {
    const f = document.createElement('form'); f.className = 'newsletter';
    f.innerHTML = '<input type="email" name="email" placeholder="Your email address" required><button class="btn" type="submit">Subscribe</button>';
    const msg = document.createElement('p'); msg.className = 'form-msg'; msg.setAttribute('role', 'status');
    box.append(f, msg);
    f.addEventListener('submit', async e => {
      e.preventDefault();
      try { await sbInsert('newsletter_subscribers', { email: f.email.value }); f.reset(); msg.className = 'form-msg ok'; msg.textContent = 'Thanks for subscribing!'; }
      catch (err) { msg.className = 'form-msg err'; msg.textContent = err.message; }
    });
  });

  // client portal magic link (Supabase Auth)
  $$('form[data-auth="login"]').forEach(f => f.addEventListener('submit', async e => {
    e.preventDefault();
    const msg = $('.form-msg', f);
    try {
      if (!SB.url || !SB.anonKey) throw new Error('The client portal is not connected yet.');
      const r = await fetch(`${SB.url}/auth/v1/otp`, { method: 'POST', headers: { apikey: SB.anonKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: f.email.value, create_user: false }) });
      if (!r.ok) throw new Error('We could not find an account for that email.');
      msg.className = 'form-msg ok'; msg.textContent = 'Check your inbox for a login link.';
    } catch (err) { msg.className = 'form-msg err'; msg.textContent = err.message; }
  }));
})();
