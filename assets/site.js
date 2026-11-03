// Trinity site behaviour: nav, back-to-top, click-to-play videos, blog search + pagination,
// site search, and Supabase-backed forms (inquiry, product, shop, claim, career, whistleblowing, contact, payment).
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const SB = (window.SITE && window.SITE.supabase) || {};
  const base = (window.SITE && window.SITE.base) || '';
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // nav
  const toggle = $('.menu-toggle'), nav = $('.main-nav');
  toggle && toggle.addEventListener('click', () => { const o = nav.classList.toggle('open'); toggle.setAttribute('aria-expanded', o); });
  $$('.nav-parent').forEach(a => a.addEventListener('click', e => {
    if (matchMedia('(max-width:980px)').matches || a.getAttribute('href') === '#') { e.preventDefault(); a.parentElement.classList.toggle('open'); }
  }));

  // back to top
  const top = $('.to-top');
  addEventListener('scroll', () => top && top.classList.toggle('show', scrollY > 500), { passive: true });
  top && top.addEventListener('click', e => { e.preventDefault(); scrollTo({ top: 0, behavior: 'smooth' }); });

  // videos: cover image first, play (with sound) only when clicked; one at a time
  $$('.video-thumb').forEach(b => b.addEventListener('click', () => {
    if (b.querySelector('video')) return;
    $$('.video-thumb video').forEach(v => { v.pause(); v.remove(); });
    const v = document.createElement('video');
    v.src = b.dataset.video; v.controls = true; v.autoplay = true; v.playsInline = true;
    b.appendChild(v); v.play().catch(() => {});
  }));

  // blog: search + pagination
  $$('[data-paginate]').forEach(grid => {
    const per = +grid.dataset.paginate, cards = $$('.post-card', grid), pager = grid.parentElement.querySelector('.pager');
    const q = $('#blog-q'), none = grid.parentElement.querySelector('.no-results');
    let list = cards;
    const show = n => {
      const pages = Math.max(1, Math.ceil(list.length / per));
      n = Math.min(Math.max(1, n), pages);
      cards.forEach(c => c.hidden = true);
      list.forEach((c, i) => c.hidden = i < (n - 1) * per || i >= n * per);
      pager.innerHTML = pages < 2 ? '' : Array.from({ length: pages }, (_, i) => `<button ${i + 1 === n ? 'aria-current="page"' : ''} data-p="${i + 1}">${i + 1}</button>`).join('');
      if (none) none.hidden = list.length > 0;
    };
    pager.addEventListener('click', e => { const b = e.target.closest('button'); if (b) { show(+b.dataset.p); grid.scrollIntoView({ behavior: 'smooth' }); } });
    q && q.addEventListener('input', () => { const v = q.value.trim().toLowerCase(); list = v ? cards.filter(c => c.dataset.title.includes(v)) : cards; show(1); });
    show(+(new URLSearchParams(location.search).get('page')) || 1);
  });

  // site search
  const sq = $('#q');
  if (sq) {
    let idx = [];
    const run = () => {
      const v = sq.value.trim().toLowerCase(), out = $('#results');
      if (!v) { out.innerHTML = ''; return; }
      const hits = idx.filter(x => (x.t + ' ' + x.d).toLowerCase().includes(v)).slice(0, 40);
      out.innerHTML = hits.length ? hits.map(h => `<li><a href="${base + h.u}">${esc(h.t)}</a><p>${esc(h.d)}</p></li>`).join('') : '<li>No results.</li>';
    };
    fetch(base + '/search.json').then(r => r.json()).then(d => { idx = d; run(); });
    sq.value = new URLSearchParams(location.search).get('q') || '';
    sq.addEventListener('input', run);
  }

  // Supabase
  async function sbInsert(table, row) {
    if (!SB.url || !SB.anonKey) throw new Error('Forms are not connected yet.');
    const r = await fetch(`${SB.url}/rest/v1/${table}`, { method: 'POST', headers: { apikey: SB.anonKey, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(row) });
    if (!r.ok) throw new Error('Submission failed (' + r.status + ').');
  }
  async function sbUpload(file, folder) {
    if (!file || !file.size) return null;
    if (file.size > 10 * 1024 * 1024) throw new Error('Attachment is larger than 10 MB.');
    const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${file.name.replace(/[^\w.-]/g, '_')}`;
    const r = await fetch(`${SB.url}/storage/v1/object/submissions/${path}`, { method: 'POST', headers: { apikey: SB.anonKey, 'Content-Type': file.type || 'application/octet-stream' }, body: file });
    if (!r.ok) throw new Error('Attachment upload is not available yet – please email it to trinity@trinity-insures.com.');
    return path;
  }

  const F = {
    name: '<label>First name*<input name="first_name" required autocomplete="given-name"></label><label>Last name*<input name="last_name" required autocomplete="family-name"></label>',
    contact: '<label>Email*<input name="email" type="email" required autocomplete="email"></label><label>Phone*<input name="phone" type="tel" required autocomplete="tel" placeholder="+63"></label>',
    company: '<label class="full">Company<input name="company" autocomplete="organization"></label>',
    message: (req, label = 'Message') => `<label class="full">${label}${req ? '*' : ''}<textarea name="message"${req ? ' required' : ''}></textarea></label>`,
    consent: `<label class="full check"><input type="checkbox" required> <span>I agree to the <a href="${base}/privacy-policy" target="_blank">Privacy Policy</a> and consent to Trinity processing my personal data for this request.</span></label>`
  };
  const LAYOUTS = {
    product: el => F.name + F.contact + F.company + `<label class="full">Interested in*<input name="subject" required value="${esc(el.dataset.subject)}"></label>` + F.message(false),
    shop: el => F.name + F.contact + `<label class="full">Product<input name="subject" readonly value="${esc(el.dataset.subject)}"></label><label>Value of bicycle / big bike (PHP)<input name="value" inputmode="numeric"></label><label>Brand / model<input name="model"></label>` + F.message(false),
    contact: () => F.name + F.contact + F.company + F.message(true),
    payment: () => F.name + F.contact + '<label class="full">Policy / invoice number<input name="subject"></label>' + F.message(false),
    claim: () => F.name + F.contact + '<label>Policy number<input name="policy"></label><label>Type of claim*<select name="subject" required><option value="">Choose one</option><option>Motor</option><option>Non-motor</option><option>Property / Fire</option><option>Marine and Cargo Hull</option><option>HMO / Medical</option><option>Travel</option><option>Others</option></select></label><label class="full">Claims attachment (PDF/JPG, max 10 MB)<input type="file" name="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"></label>' + F.message(false, 'Additional message'),
    career: () => F.name + F.contact + '<label class="full">Position applying for*<input name="subject" required></label><label class="full">Updated résumé (CV)* (PDF/DOC, max 10 MB)<input type="file" name="file" required accept=".pdf,.doc,.docx"></label>' + F.message(false, 'Cover note'),
    whistleblowing: () => '<label class="full check"><input type="checkbox" name="anonymous" value="yes"> <span>Submit anonymously (leave name and contact details blank)</span></label><label>Name<input name="first_name"></label><label>Email<input name="email" type="email"></label><label class="full">Subject of the report*<input name="subject" required></label>' + F.message(true, 'Details of the concern') + '<label class="full">Supporting document (optional)<input type="file" name="file"></label>'
  };
  $$('[data-form]').forEach(el => {
    const kind = el.dataset.form;
    const make = LAYOUTS[kind] || LAYOUTS.contact;
    el.innerHTML = `<form class="tform" novalidate>${make(el)}${F.consent}<div class="full"><button class="btn" type="submit">Submit</button><p class="form-msg" role="status"></p></div></form>`;
    const f = $('form', el), msg = $('.form-msg', el);
    f.addEventListener('submit', async e => {
      e.preventDefault();
      if (!f.reportValidity()) return;
      const d = Object.fromEntries(new FormData(f));
      const btn = $('button[type=submit]', f); btn.disabled = true;
      msg.className = 'form-msg'; msg.textContent = 'Sending…';
      try {
        const file = f.file && f.file.files[0];
        const attachment = file ? await sbUpload(file, kind) : null;
        const extra = {}; ['value', 'model', 'policy', 'anonymous'].forEach(k => d[k] && (extra[k] = d[k]));
        if (attachment) extra.attachment = attachment;
        await sbInsert('inquiries', {
          kind, name: [d.first_name, d.last_name].filter(Boolean).join(' ') || null, email: d.email || null, phone: d.phone || null,
          company: d.company || null, subject: d.subject || null, message: d.message || null, page: location.pathname,
          payload: { first_name: d.first_name || null, last_name: d.last_name || null, ...extra }
        });
        f.reset(); msg.className = 'form-msg ok';
        msg.textContent = kind === 'career' ? 'Thank you! Our HR team will coordinate with you regarding your application.' : kind === 'whistleblowing' ? 'Thank you. Your report has been received and will be handled confidentially.' : 'Thank you! Our team will get back to you shortly.';
      } catch (err) { msg.className = 'form-msg err'; msg.textContent = err.message + ' You can also email trinity@trinity-insures.com.'; }
      btn.disabled = false;
    });
  });

  // client portal magic link (Supabase Auth – existing clients only)
  $$('form[data-auth="login"]').forEach(f => f.addEventListener('submit', async e => {
    e.preventDefault();
    const msg = $('.form-msg', f);
    try {
      if (!SB.url || !SB.anonKey) throw new Error('The client portal is not connected yet.');
      const r = await fetch(`${SB.url}/auth/v1/otp`, { method: 'POST', headers: { apikey: SB.anonKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: f.email.value, create_user: false, options: { emailRedirectTo: location.origin + base + '/client-portal' } }) });
      if (!r.ok) throw new Error('We could not find a client account for that email. Please contact your account officer.');
      msg.className = 'form-msg ok'; msg.textContent = 'Check your inbox for a secure login link.';
    } catch (err) { msg.className = 'form-msg err'; msg.textContent = err.message; }
  }));
})();
