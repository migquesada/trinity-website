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
    if (!r.ok) throw new Error('We could not upload the attachment.');
    return path;
  }

  // ---------- forms (simple, friendly, mobile-first) ----------
  const isTest = !location.hostname.endsWith((window.SITE && window.SITE.prodHost) || 'trinity-insures.com');
  const field = (name, label, { type = 'text', req = true, ac = '', ph = '', full = false, hint = '', attrs = '' } = {}) =>
    `<label class="fld${full ? ' full' : ''}"><span>${label}${req ? '' : ' <em>(optional)</em>'}</span>` +
    (type === 'textarea' ? `<textarea name="${name}"${req ? ' required' : ''} placeholder="${ph}" rows="4" ${attrs}></textarea>`
      : `<input name="${name}" type="${type}"${req ? ' required' : ''}${ac ? ` autocomplete="${ac}"` : ''} placeholder="${ph}" ${attrs}>`) +
    (hint ? `<small>${hint}</small>` : '') + '<b class="err-msg" aria-live="polite"></b></label>';
  const select = (name, label, opts, { req = true, full = true, value = '' } = {}) =>
    `<label class="fld${full ? ' full' : ''}"><span>${label}${req ? '' : ' <em>(optional)</em>'}</span><select name="${name}"${req ? ' required' : ''}><option value="">Select one</option>${opts.map(o => `<option${o === value ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select><b class="err-msg" aria-live="polite"></b></label>`;
  const pills = (name, label, opts) =>
    `<fieldset class="pills full"><legend>${label}</legend>${opts.map((o, i) => `<label><input type="radio" name="${name}" value="${esc(o)}"${i === 0 ? ' checked' : ''}><span>${esc(o)}</span></label>`).join('')}</fieldset>`;
  const file = (label, req, hint) => `<label class="fld full file"><span>${label}${req ? '' : ' <em>(optional)</em>'}</span><input type="file" name="file"${req ? ' required' : ''} accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"><small>${hint}</small><b class="err-msg" aria-live="polite"></b></label>`;
  const NAME = field('name', 'Full name', { ac: 'name', ph: 'Juan dela Cruz' });
  const EMAIL = field('email', 'Email', { type: 'email', ac: 'email', ph: 'you@company.com' });
  const PHONE = (req = false) => field('phone', 'Mobile number', { type: 'tel', ac: 'tel', ph: '0917 123 4567', req });
  const LAYOUTS = {
    contact: () => pills('topic', 'How can we help?', ['Get a quote', 'Policy question', 'Claims', 'Other']) + NAME + EMAIL + PHONE() + field('company', 'Company', { ac: 'organization', req: false }) + field('message', 'Your message', { type: 'textarea', full: true, ph: 'Tell us a little about what you need.' }),
    product: el => NAME + EMAIL + PHONE() + field('company', 'Company', { ac: 'organization', req: false }) + `<input type="hidden" name="topic" value="${esc(el.dataset.subject)}">` + field('message', 'Anything we should know?', { type: 'textarea', full: true, req: false, ph: `e.g. number of employees, assets to insure, current insurer` }),
    shop: el => NAME + EMAIL + PHONE(true) + field('value', 'Bike value (PHP)', { type: 'number', req: false, ph: '50000', attrs: 'inputmode="numeric" min="0"' }) + field('model', 'Brand and model', { req: false, ph: 'e.g. Trek Marlin 7' }) + `<input type="hidden" name="topic" value="${esc(el.dataset.subject)}">`,
    claim: () => select('topic', 'Type of claim', ['Motor', 'Non-motor', 'Property / Fire', 'Marine and Cargo Hull', 'HMO / Medical', 'Travel', 'Other']) + NAME + EMAIL + PHONE(true) + field('policy', 'Policy number', { req: false, hint: "If you don't have it handy, leave it blank." }) + field('message', 'What happened?', { type: 'textarea', full: true, ph: 'Date, place and a short description.' }) + file('Supporting documents', false, 'Photos, police report or policy copy · PDF, JPG or PNG · up to 10 MB'),
    career: () => NAME + EMAIL + PHONE(true) + field('topic', 'Position you are applying for', { ph: 'e.g. Accounts Specialist, or "Open application"' }) + file('Résumé / CV', true, 'PDF or Word · up to 10 MB') + field('message', 'Short note', { type: 'textarea', full: true, req: false }),
    payment: () => NAME + EMAIL + PHONE() + field('policy', 'Policy or invoice number', { req: false }) + field('message', 'Your question', { type: 'textarea', full: true }),
    whistleblowing: () => `<label class="check full anon"><input type="checkbox" name="anonymous" value="yes"><span><strong>Report anonymously.</strong> We won't ask for your name or contact details.</span></label><div class="who full">` + field('name', 'Your name', { req: false }) + field('email', 'Email for follow-up', { type: 'email', req: false }) + `</div>` + field('topic', 'What is this about?', { full: true, ph: 'Short subject' }) + field('message', 'Describe the concern', { type: 'textarea', full: true, ph: 'What happened, when, and who was involved.' }) + file('Supporting document', false, 'PDF, JPG or PNG · up to 10 MB')
  };
  const CONSENT = `<label class="check full"><input type="checkbox" name="consent" required><span>I agree that Trinity may use these details to respond to my request, in line with the <a href="${base}/privacy-policy" target="_blank">Privacy Policy</a>.</span></label>`;
  const validate = f => {
    let ok = true;
    $$('.fld', f).forEach(l => {
      const i = l.querySelector('input,textarea,select'); const m = l.querySelector('.err-msg'); if (!i || !m) return;
      let msg = '';
      if (i.required && !i.value.trim() && i.type !== 'file') msg = 'Please fill this in.';
      else if (i.type === 'file' && i.required && !i.files.length) msg = 'Please attach a file.';
      else if (i.type === 'email' && i.value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(i.value)) msg = 'Please check the email address.';
      else if (i.type === 'tel' && i.value && i.value.replace(/\D/g, '').length < 7) msg = 'Please check the number.';
      else if (i.type === 'file' && i.files[0] && i.files[0].size > 10 * 1024 * 1024) msg = 'File is larger than 10 MB.';
      m.textContent = msg; l.classList.toggle('bad', !!msg); if (msg) ok = false;
    });
    const c = f.querySelector('input[name=consent]'); if (c && !c.checked) { c.closest('label').classList.add('bad'); ok = false; } else if (c) c.closest('label').classList.remove('bad');
    if (!ok) { const first = f.querySelector('.bad input,.bad textarea,.bad select'); first && first.focus(); }
    return ok;
  };
  const TITLES = { contact: 'Message sent', product: 'Request received', shop: 'Request received', claim: 'Claim received', career: 'Application received', payment: 'Message sent', whistleblowing: 'Report received' };
  const NEXT = { career: 'Our HR team will review your application and contact you if there is a match.', whistleblowing: 'Your report will be handled confidentially by our compliance team.', claim: 'A claims officer will contact you within one business day.' };
  $$('[data-form]').forEach(el => {
    const kind = el.dataset.form;
    const make = LAYOUTS[kind] || LAYOUTS.contact;
    el.innerHTML = `<form class="tform" novalidate>${isTest ? '<p class="test-flag full">Test site: submissions here are marked TEST.</p>' : ''}${make(el)}<input type="text" name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">${CONSENT}<div class="full actions"><button class="btn" type="submit">Send</button><p class="form-msg" role="status"></p></div></form>`;
    const f = $('form', el), msg = $('.form-msg', el);
    const anon = f.querySelector('input[name=anonymous]');
    anon && anon.addEventListener('change', () => { f.querySelector('.who').hidden = anon.checked; });
    f.addEventListener('input', e => { const l = e.target.closest('.fld'); if (l && l.classList.contains('bad')) validate(f); });
    f.addEventListener('submit', async e => {
      e.preventDefault();
      if (!validate(f)) return;
      const d = Object.fromEntries(new FormData(f));
      if (d.website) return; // spam trap
      const btn = $('button[type=submit]', f); btn.disabled = true; btn.textContent = 'Sending…'; msg.className = 'form-msg'; msg.textContent = '';
      const ref = 'TRN-' + Date.now().toString(36).toUpperCase().slice(-6);
      try {
        const fileIn = f.querySelector('input[type=file]');
        const attachment = fileIn && fileIn.files[0] ? await sbUpload(fileIn.files[0], kind) : null;
        const anonymous = d.anonymous === 'yes';
        await sbInsert('inquiries', {
          kind, name: anonymous ? null : (d.name || null), email: anonymous ? null : (d.email || null), phone: d.phone || null,
          company: d.company || null, subject: d.topic || null, message: d.message || null, page: location.pathname,
          payload: { ref, test: isTest, site: location.hostname, policy: d.policy || null, value: d.value || null, model: d.model || null, anonymous, attachment }
        });
        el.innerHTML = `<div class="form-done"><div class="tick" aria-hidden="true">✓</div><h3>${TITLES[kind] || 'Message sent'}</h3><p>Thank you${!anonymous && d.name ? ', ' + esc(d.name.split(' ')[0]) : ''}. ${NEXT[kind] || 'Our team will get back to you within one business day.'}</p><p class="muted">Reference: <strong>${ref}</strong>${isTest ? ' · TEST submission' : ''}</p></div>`;
      } catch (err) {
        btn.disabled = false; btn.textContent = 'Send';
        msg.className = 'form-msg err'; msg.innerHTML = esc(err.message) + ` You can also email <a href="mailto:trinity@trinity-insures.com">trinity@trinity-insures.com</a> or call +632 8810 1653.`;
      }
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
