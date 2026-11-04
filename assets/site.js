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
    let cat = '';
    const apply = () => { const v = q ? q.value.trim().toLowerCase() : ''; list = cards.filter(c => (!v || c.dataset.title.includes(v)) && (!cat || c.dataset.cat === cat)); show(1); };
    q && q.addEventListener('input', apply);
    $$('.blog-tools .chips button').forEach(b => b.addEventListener('click', () => { $$('.blog-tools .chips button').forEach(x => x.classList.toggle('on', x === b)); cat = b.dataset.cat; apply(); }));
    show(+(new URLSearchParams(location.search).get('page')) || 1);
  });

  // article: reading progress + copy link
  const prog = $('.read-progress span'), art = $('.post');
  if (prog && art) addEventListener('scroll', () => { const r = art.getBoundingClientRect(); const p = Math.min(1, Math.max(0, -r.top / (r.height - innerHeight))); prog.style.width = (p * 100) + '%'; }, { passive: true });
  $$('.copy-link').forEach(b => b.addEventListener('click', async () => { try { await navigator.clipboard.writeText(b.dataset.url); b.classList.add('done'); b.setAttribute('aria-label', 'Link copied'); setTimeout(() => b.classList.remove('done'), 1800); } catch (e) {} }));

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

  // ---------- forms v3: specific, conditional, step-by-step where it helps ----------
  const isTest = !location.hostname.endsWith((window.SITE && window.SITE.prodHost) || 'trinity-insures.com');
  const opt = req => req ? '' : ' <em>(optional)</em>';
  const err = '<b class="err-msg" aria-live="polite"></b>';
  const field = (name, label, { type = 'text', req = true, ac = '', ph = '', full = false, hint = '', attrs = '', value = '' } = {}) =>
    `<label class="fld${full ? ' full' : ''}"><span>${label}${opt(req)}</span>` +
    (type === 'textarea' ? `<textarea name="${name}"${req ? ' required' : ''} placeholder="${ph}" rows="4" ${attrs}>${esc(value)}</textarea>`
      : `<input name="${name}" type="${type}"${req ? ' required' : ''}${ac ? ` autocomplete="${ac}"` : ''} placeholder="${ph}" value="${esc(value)}" ${attrs}>`) +
    (hint ? `<small>${hint}</small>` : '') + err + '</label>';
  const select = (name, label, opts, { req = true, full = true, value = '', hint = '' } = {}) =>
    `<label class="fld${full ? ' full' : ''}"><span>${label}${opt(req)}</span><select name="${name}"${req ? ' required' : ''}><option value="">Select one</option>${opts.map(o => `<option${o === value ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>${hint ? `<small>${hint}</small>` : ''}${err}</label>`;
  const pills = (name, label, opts, { req = true, value, multi = false, hint = '' } = {}) =>
    `<fieldset class="pills full${multi ? ' multi' : ''}"${req ? ' data-req' : ''}><legend>${label}${opt(req)}</legend>${opts.map((o, i) => `<label><input type="${multi ? 'checkbox' : 'radio'}" name="${name}" value="${esc(o)}"${(value === undefined ? (!multi && i === 0 && req) : o === value) ? ' checked' : ''}><span>${esc(o)}</span></label>`).join('')}${hint ? `<small>${hint}</small>` : ''}${err}</fieldset>`;
  const cards = (name, label, opts, { value = '', req = true } = {}) =>
    `<fieldset class="opt-cards full"${req ? ' data-req' : ''}><legend>${label}</legend>${opts.map(o => `<label><input type="radio" name="${name}" value="${esc(o.v)}"${o.v === value ? ' checked' : ''}><span>${o.ic ? `<i aria-hidden="true">${o.ic}</i>` : ''}<strong>${esc(o.v)}</strong>${o.d ? `<small>${esc(o.d)}</small>` : ''}</span></label>`).join('')}${err}</fieldset>`;
  const yesno = (name, label) => pills(name, label, ['No', 'Yes'], { value: 'No' });
  const file = (name, label, req, hint = 'PDF, JPG or PNG · up to 10 MB') => `<label class="fld full file"><span>${label}${opt(req)}</span><input type="file" name="${name}" data-label="${esc(label)}"${req ? ' required' : ''} accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"><small>${hint}</small>${err}</label>`;
  const when = (cond, html, cls = '') => `<div class="cond full ${cls}" data-when="${esc(cond)}">${html}</div>`;
  const note = (html, cls = '') => `<div class="fnote full ${cls}">${html}</div>`;
  const row = html => `<div class="frow full">${html}</div>`;
  const NAME = field('name', 'Full name', { ac: 'name', ph: 'Juan dela Cruz' });
  const EMAIL = field('email', 'Email', { type: 'email', ac: 'email', ph: 'you@company.com' });
  const PHONE = (req = false) => field('phone', 'Mobile number', { type: 'tel', ac: 'tel', ph: '0917 123 4567', req });
  const FIRSTLAST = field('first_name', 'First name', { ac: 'given-name' }) + field('last_name', 'Last name', { ac: 'family-name' });
  const PRODUCTS = ['Property / Fire', 'Motor or fleet', 'HMO / Group medical', 'Group life & accident', 'Liability', 'Marine / Cargo', 'Cyber', 'Bonds', 'Travel', 'Something else'];
  const CLAIMS = ['Motor', 'Non-motor', 'Property / Fire', 'Marine and Cargo Hull', 'HMO / Medical', 'Travel', 'Pre-approval / Treatment plan / Dental', 'Other'];
  const INDUSTRIES = ['Automotive', 'Aviation', 'BPO / Shared services', 'Construction', 'Education', 'Energy & utilities', 'Financial services', 'Food & beverage', 'Healthcare', 'Hospitality & tourism', 'IT & telecommunications', 'Logistics & shipping', 'Manufacturing', 'Real estate', 'Retail', 'Other'];
  const roles = el => { try { return JSON.parse(el.dataset.roles || '[]'); } catch (e) { return []; } };

  const LAYOUTS = {
    contact: () => pills('topic', 'How can we help?', ['Get a quote', 'Policy question', 'Claims', 'Careers', 'Something else']) +
      when('topic!=Careers', NAME + EMAIL + PHONE()) +
      when('topic=Get a quote',
        pills('cover_for', 'Who is the cover for?', ['My business', 'Me or my family']) +
        when('cover_for=My business', field('company', 'Company name', { ac: 'organization' }) + select('industry', 'Industry', INDUSTRIES, { full: false }) + select('employees', 'Number of employees', ['1–9', '10–49', '50–249', '250–999', '1,000 or more'], { full: false, req: false })) +
        pills('needs', 'What would you like to cover?', PRODUCTS, { multi: true, hint: 'Choose all that apply.' }) +
        select('timing', 'When do you need cover?', ['As soon as possible', 'Within the next month', 'At my next renewal', 'Just exploring options'], { full: false }) +
        field('insurer', 'Current insurer', { req: false, ph: 'If you have one' }) +
        field('message', 'Anything else we should know?', { type: 'textarea', full: true, req: false, ph: 'e.g. assets to insure, number of vehicles, renewal date' })) +
      when('topic=Policy question',
        select('qtype', 'What is it about?', ['Renewal', 'Changes to my policy (endorsement)', 'Billing or payment', 'Certificate or policy documents', 'Coverage question', 'Something else'], { full: false }) +
        field('policy', 'Policy number', { req: false, hint: 'Speeds things up, but not required.' }) +
        field('message', 'Your question', { type: 'textarea', full: true })) +
      when('topic=Claims',
        note(`Filing a new claim? Our <a href="${base}/claims">claims guide</a> lists the documents you need for each type of claim.`) +
        select('claim_type', 'Type of claim', CLAIMS, { full: false }) + field('policy', 'Policy number', { req: false }) +
        field('incident_date', 'Date of incident', { type: 'date', req: false }) + field('company', 'Company', { req: false, ac: 'organization' }) +
        field('message', 'What happened, or what do you need help with?', { type: 'textarea', full: true })) +
      when('topic=Careers', note(`<strong>Looking to join Trinity?</strong> Applications are handled on our Careers page, where you can see open roles and send your CV in a few minutes.<span class="fnote-btns"><a class="btn btn-sm btn-orange" href="${base}/careers#openings">See open roles</a><a class="btn btn-sm" href="${base}/careers#apply">Send your CV</a></span>`, 'big')) +
      when('topic=Something else', field('subject', 'Subject', { full: true }) + field('message', 'Your message', { type: 'textarea', full: true })),
    product: el => NAME + EMAIL + PHONE() + field('company', 'Company', { ac: 'organization', req: false }) + `<input type="hidden" name="topic" value="${esc(el.dataset.subject)}">` +
      select('timing', 'When do you need cover?', ['As soon as possible', 'Within the next month', 'At my next renewal', 'Just exploring options'], { full: false, req: false }) + select('employees', 'Number of employees', ['1–9', '10–49', '50–249', '250–999', '1,000 or more'], { full: false, req: false }) +
      field('message', 'Anything we should know?', { type: 'textarea', full: true, req: false, ph: 'e.g. assets to insure, current insurer, renewal date' }),
    shop: el => NAME + EMAIL + PHONE(true) + field('value', 'Bike value (PHP)', { type: 'number', req: false, ph: '50000', attrs: 'inputmode="numeric" min="0"' }) + field('model', 'Brand and model', { req: false, ph: 'e.g. Trek Marlin 7' }) + `<input type="hidden" name="topic" value="${esc(el.dataset.subject)}">`,
    claim: el => select('topic', 'Type of claim', CLAIMS, { full: false, value: el.dataset.subject || '' }) + field('policy', 'Policy number', { req: false, hint: "If you don't have it handy, leave it blank." }) +
      NAME + EMAIL + PHONE(true) + field('company', 'Company', { req: false, ac: 'organization' }) +
      field('incident_date', 'Date of incident', { type: 'date', req: false }) + field('incident_place', 'Where did it happen?', { req: false }) +
      field('message', 'What happened?', { type: 'textarea', full: true, ph: 'A short description is enough. Our claims officer will guide you on the next steps.' }) +
      file('file', 'Photos or documents you already have', false, 'Photos, police report or policy copy · PDF, JPG or PNG · up to 10 MB'),
    career: el => {
      const list = roles(el).map(r => r.title), GEN = 'General application (talent pool)';
      return select('topic', 'Role you are applying for', [...list, GEN], { value: el.dataset.subject || (list.length ? '' : GEN) }) +
        when(`topic=${GEN}`, select('area', 'Which team interests you most?', ['Account management / client service', 'Claims', 'Technical / underwriting', 'Employee benefits', 'Reinsurance', 'Finance & administration', 'Marketing & business development', 'IT', 'Not sure yet'])) +
        FIRSTLAST + field('email', 'Email', { type: 'email', ac: 'email' }) + PHONE(true) +
        pills('office', 'Preferred office', ['Makati', 'Cebu', 'Either']) +
        select('experience', 'Relevant work experience', ['Fresh graduate', 'Less than 2 years', '2–5 years', '6–10 years', 'More than 10 years'], { full: false }) +
        field('linkedin', 'LinkedIn profile', { type: 'url', req: false, ph: 'https://linkedin.com/in/…' }) +
        file('cv', 'Résumé / CV', true, 'PDF or Word · up to 10 MB') +
        field('message', 'Why Trinity?', { type: 'textarea', full: true, req: false, ph: 'A few lines about you and what you are looking for.' }) +
        select('source', 'How did you hear about us?', ['LinkedIn', 'Facebook', 'JobStreet / job board', 'Referral from a Trinity employee', 'School / career fair', 'Other'], { req: false });
    },
    payment: () => NAME + EMAIL + PHONE() + field('policy', 'Policy or invoice number', { req: false }) + field('message', 'Your question', { type: 'textarea', full: true }),
    whistleblowing: () => `<label class="check full anon"><input type="checkbox" name="anonymous" value="yes"><span><strong>Report anonymously.</strong> We won't ask for your name or contact details.</span></label><div class="who full">` + field('name', 'Your name', { req: false }) + field('email', 'Email for follow-up', { type: 'email', req: false }) + `</div>` + field('topic', 'What is this about?', { full: true, ph: 'Short subject' }) + field('message', 'Describe the concern', { type: 'textarea', full: true, ph: 'What happened, when, and who was involved.' }) + file('file', 'Supporting document', false)
  };

  // ---------- KYC / online application (Bike, Big Bike, Pet) ----------
  const DECL = {
    common: 'I hereby apply for insurance as set out in this application and declare, to the best of my knowledge and belief, that the statements and particulars given are true and complete. I agree to notify Trinity of any material change in this information.',
    privacy: 'I voluntarily and expressly consent to the collection, processing, sharing and storing of my personal and/or sensitive information by Trinity for the purposes necessary in processing my insurance policy and related transactions, as stated in Trinity\'s Data Privacy Statement.',
    Bike: ['I am in good health and free from physical impairment or deformity.', 'No coverage will be in effect until the insurer approves this application and the premium is paid in full.', 'Under Republic Act 9160 (Anti-Money Laundering Act), as amended by RA 9194, insurers are required to establish the identity of all customers. Trinity may decline to process an application without sufficient proof of identity.', 'Any change to these details must be made in writing and submitted to Trinity before the policy start date; otherwise the policy is not enforced.'],
    'Big Bike': [],
    Pet: ['My pet(s) and I are permanent residents of the Philippines.', 'My pet is not the subject of a police complaint.', 'My pet(s) and I are in good health and free from impairment or deformity, unless stated in this application.']
  };
  const DOCS = {
    Bike: [['doc_receipt', 'Official receipt of the bicycle\'s purchase price', true], ['doc_id', 'Valid ID with address and 3 specimen signatures', true]],
    'Big Bike': [['doc_orcr', 'OR/CR of the big bike', true], ['doc_id', 'Valid ID with address and 3 specimen signatures', true], ['doc_photos', 'Photos of the bike (front, rear and sides)', true]],
    Pet: [['doc_health', 'Health / medical and vaccination records', true], ['doc_photos', 'Photos of your pet (both sides) and distinguishing features', true], ['doc_id', 'Valid ID with 3 specimen signatures', true], ['doc_pcci', 'PCCI registration', false], ['doc_passport', 'Pet passport', false], ['doc_receipt', 'Official receipt of purchase price', false], ['doc_chip', 'Microchip / RFID registration', false]]
  };
  const PI = { bike: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="5.5" cy="17" r="3.5"/><circle cx="18.5" cy="17" r="3.5"/><path d="M5.5 17 9 9h6l3.5 8M9 9 7.5 6H5M15 9l-3 8h-1"/></svg>', moto: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="5" cy="17" r="3"/><circle cx="19" cy="17" r="3"/><path d="M8 17h7l2-5h-5l-2-3H7M14 7h3l2 5"/></svg>', pet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="7" cy="8" r="2"/><circle cx="17" cy="8" r="2"/><circle cx="4.5" cy="13" r="1.8"/><circle cx="19.5" cy="13" r="1.8"/><path d="M12 12c-3 0-5 3.5-5 5.5S9 20 12 19s5 .5 5-1.5-2-5.5-5-5.5z"/></svg>' };
  const kycSteps = el => {
    const pre = ({ bike: 'Bike', 'big-bike': 'Big Bike', pet: 'Pet' })[new URLSearchParams(location.search).get('product') || ''] || '';
    const step = (title, sub, html) => `<section class="kstep" data-title="${esc(title)}"><header><h3>${esc(title)}</h3><p>${sub}</p></header><div class="kgrid">${html}</div></section>`;
    return step('Choose your cover', 'What would you like to insure? You can apply for one item at a time.',
        cards('product', 'Insurance', [{ v: 'Bike', d: 'Bicycles', ic: PI.bike }, { v: 'Big Bike', d: 'Big bikes and motorcycles', ic: PI.moto }, { v: 'Pet', d: 'Cats and dogs', ic: PI.pet }], { value: pre })) +
      step('About you', 'Tell us who will be insured. Use your name exactly as it appears on your ID.',
        FIRSTLAST + field('middle_name', 'Middle name', { req: false, ac: 'additional-name' }) + field('suffix', 'Suffix', { req: false, ph: 'Jr., III' }) +
        field('dob', 'Date of birth', { type: 'date', ac: 'bday' }) + field('birthplace', 'Place of birth', { ph: 'City / municipality' }) +
        select('gender', 'Gender', ['Male', 'Female', 'Prefer not to say'], { full: false }) + field('nationality', 'Nationality', { value: 'Filipino' }) +
        pills('civil_status', 'Civil status', ['Single', 'Married', 'Separated / Annulled', 'Widowed'], { value: '' })) +
      step('Contact details', 'We will send your policy and updates here.',
        field('email', 'Email', { type: 'email', ac: 'email', ph: 'you@email.com' }) + PHONE(true) +
        field('address', 'Home address', { full: true, ac: 'street-address', ph: 'House no., street, barangay' }) + field('city', 'City / municipality', { ac: 'address-level2' }) + field('province', 'Province', { ac: 'address-level1' }) +
        field('rep', 'Authorized representative', { req: false, hint: 'Someone we may contact on your behalf, with their mobile number.' }) +
        field('beneficiary', 'Beneficiary', { req: false }) + field('beneficiary_rel', 'Relationship to you', { req: false, ph: 'e.g. Spouse' })) +
      step('Work and identification', 'Required by the Anti-Money Laundering Act for all insurance applications.',
        pills('work', 'Employment', ['Employed', 'Self-employed / business owner', 'Retired', 'Student', 'Not employed'], { value: '' }) +
        when('work=Employed|Self-employed / business owner', field('employer', 'Employer / business name') + field('occupation', 'Position / nature of work') + field('employer_address', 'Employer / business address', { full: true })) +
        pills('funds', 'Source of funds', ['Salary', 'Business income', 'Pension', 'Remittances', 'Savings / investments', 'Allowance / family support'], { multi: true, hint: 'Choose all that apply.' }) +
        field('tin', 'TIN', { ph: '000-000-000-000', attrs: 'inputmode="numeric"' }) + field('other_id', 'SSS / GSIS / UMID number', { req: false }) +
        yesno('pep', 'Are you, or have you been, a government official?') + when('pep=Yes', field('pep_position', 'Position held', { full: true })) +
        yesno('pep_rel', 'Do you have a close personal or family relationship with a government official?')) +
      step('Insured item', 'Details of what you are insuring.',
        when('product=Bike', field('brand', 'Brand and model', { ph: 'e.g. Trek Marlin 7' }) + field('year', 'Year acquired', { type: 'number', attrs: 'inputmode="numeric" min="1990" max="2030"' }) +
          field('value', 'Market value or purchase price (PHP)', { type: 'number', attrs: 'inputmode="numeric" min="0"', hint: 'Purchase price if new.' }) +
          pills('accessories', 'Accessories to include', ['Reflectors', 'GPS', 'LED lights', 'Helmet', 'Protective gear'], { multi: true, req: false }) + field('other_accessories', 'Other accessories', { req: false }) +
          cards('biker_class', 'How do you use your bike?', [{ v: 'Class A', d: 'Commuting to and from work, school or errands, and for leisure' }, { v: 'Class B', d: 'Commercial use, e.g. deliveries of goods and services' }])) +
        when('product=Big Bike', field('year', 'Year model', { type: 'number', attrs: 'inputmode="numeric" min="1990" max="2030"' }) + field('make', 'Make / brand', { ph: 'e.g. Honda' }) + field('model', 'Model', { ph: 'e.g. CB650R' }) + field('variant', 'Series / variant', { req: false }) +
          field('value', 'Market value or purchase price (PHP)', { type: 'number', attrs: 'inputmode="numeric" min="0"', hint: 'Purchase price if new.' })) +
        when('product=Pet', field('pet_name', 'Pet\'s name') + pills('pet_kind', 'Cat or dog?', ['Dog', 'Cat'], { value: '' }) + field('breed', 'Breed') + select('pet_gender', 'Pet\'s sex', ['Male', 'Female'], { full: false }) +
          field('pet_dob', 'Pet\'s date of birth', { type: 'date' }) + field('pet_birthplace', 'Place of birth', { req: false }) + field('color', 'Color / markings') + field('features', 'Distinguishing features', { req: false }) +
          yesno('microchip', 'Does your pet have a microchip?') + when('microchip=Yes', field('chip_no', 'Microchip number')) + field('pet_passport', 'Pet passport number', { req: false }) +
          field('vet', 'Veterinarian / clinic') + field('conditions', 'Past or present illnesses and injuries', { type: 'textarea', full: true, req: false, ph: 'Leave blank if none.' }) +
          select('package', 'Package', ['Package A', 'Package B', 'Package C', 'Package D', 'Package E', 'Package F'], { full: false, hint: 'Not sure? Choose one and our team will help you compare.' }))) +
      step('Documents', 'Clear phone photos are fine. You can also email them later if you don\'t have them now.',
        Object.entries(DOCS).map(([p, list]) => when(`product=${p}`, list.map(([n, l, r]) => file(n, l, false, r ? 'Required · PDF, JPG or PNG · up to 10 MB' : 'PDF, JPG or PNG · up to 10 MB')).join(''))).join('') +
        note('Can\'t upload now? Send your documents to <a href="mailto:trinity@trinity-insures.com">trinity@trinity-insures.com</a> with your reference number.')) +
      step('Review and submit', 'Please check your details before you submit.',
        '<div class="kreview full"></div>' +
        Object.entries(DECL).filter(([k]) => !['common', 'privacy'].includes(k)).map(([p, list]) => when(`product=${p}`, `<div class="decl full"><p><strong>Declarations</strong></p><ul>${[...list, DECL.common].map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>`)).join('') +
        `<label class="check full"><input type="checkbox" name="declare" required><span>I confirm the declarations above are true and complete.</span></label>` +
        `<label class="check full"><input type="checkbox" name="consent" required><span>${esc(DECL.privacy)} <a href="${base}/data-privacy-consent-form" target="_blank">Read the full consent</a>.</span></label>`);
  };

  // ---------- Client Portal registration (general, exploratory) ----------
  const portalSteps = () => {
    const step = (title, sub, html) => `<section class="kstep" data-title="${esc(title)}"><header><h3>${esc(title)}</h3><p>${sub}</p></header><div class="kgrid">${html}</div></section>`;
    const ic = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
    return step('Account type', 'Tell us how you are connected to Trinity.',
        cards('account_type', 'I am registering as', [
          { v: 'Policyholder', d: 'I hold a policy in my own name', ic: ic('<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a7 7 0 0 1 14 0v1"/>') },
          { v: 'Company administrator', d: 'I manage my company\'s policies or benefits', ic: ic('<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M9 21v-4h6v4M8 7h.01M12 7h.01M16 7h.01M8 11h.01M12 11h.01M16 11h.01"/>') },
          { v: 'Plan member', d: 'I am covered under my employer\'s plan', ic: ic('<circle cx="9" cy="7" r="3.5"/><path d="M2 20v-1a6 6 0 0 1 12 0v1M16 3.5a3.5 3.5 0 0 1 0 7M22 20v-1a6 6 0 0 0-4-5.6"/>') }])) +
      step('Your details', 'Use your name exactly as it appears on your ID.',
        FIRSTLAST + field('email', 'Email', { type: 'email', ac: 'email', hint: 'This will be your sign-in email.' }) + PHONE(true) +
        field('dob', 'Date of birth', { type: 'date', ac: 'bday' }) +
        when('account_type=Company administrator|Plan member', field('company', 'Company name', { ac: 'organization' }) + field('position', 'Position / department', { req: false })) +
        when('account_type=Plan member', field('employee_id', 'Employee ID', { req: false }))) +
      step('Your coverage', 'This helps us match your account to the right records. Leave anything you don\'t know blank.',
        field('policy', 'Policy or member number', { req: false, hint: 'Found on your policy schedule or member card.' }) + field('insurer', 'Insurer or HMO provider', { req: false }) +
        pills('coverage', 'Type of coverage', ['HMO / Group medical', 'Life & accident', 'Property / Fire', 'Motor', 'Marine', 'Liability', 'Travel', 'Other'], { multi: true, req: false, hint: 'Choose all that apply.' })) +
      step('Verify your identity', 'We confirm every account before access is granted.',
        select('id_type', 'Valid ID', ['PhilSys National ID', 'Passport', 'Driver\'s License', 'UMID', 'SSS ID', 'PRC ID', 'Postal ID', 'Other government ID'], { full: false }) +
        field('id_number', 'ID number', { ac: 'off' }) +
        file('id_photo', 'Photo of your ID', false, 'Front side, clear and readable · JPG, PNG or PDF · up to 10 MB')) +
      step('Notifications', 'Choose how you\'d like to hear from us.',
        pills('channel', 'Send updates by', ['Email', 'SMS', 'Email and SMS']) +
        pills('alerts', 'Notify me about', ['Policy renewals', 'Claim status', 'Billing reminders', 'New documents'], { multi: true, req: false })) +
      step('Review and submit', 'Please check your details before you submit.',
        '<div class="kreview full"></div>' +
        `<label class="check full"><input type="checkbox" name="declare" required><span>I confirm that the information I provided is true and correct.</span></label>` +
        `<label class="check full"><input type="checkbox" name="consent" required><span>I consent to Trinity processing my personal information to create and verify my client account, in line with the <a href="${base}/privacy-policy" target="_blank">Privacy Policy</a>.</span></label>`);
  };

  const CONSENT = `<label class="check full"><input type="checkbox" name="consent" required><span>I agree that Trinity may use these details to respond to my request, in line with the <a href="${base}/privacy-policy" target="_blank">Privacy Policy</a>.</span></label>`;
  const SUBMIT_WHEN = { contact: 'topic!=Careers' };
  const LABEL_SUBMIT = { career: 'Submit application', claim: 'Submit claim', kyc: 'Submit application', whistleblowing: 'Submit report' };

  const val = (f, name) => { const els = $$(`[name="${name}"]`, f).filter(e => !e.disabled); if (!els.length) return ''; if (els[0].type === 'radio') return (els.find(e => e.checked) || {}).value || ''; if (els[0].type === 'checkbox') return els.filter(e => e.checked).map(e => e.value).join('|'); return els[0].value; };
  const refresh = f => {
    $$('.cond', f).forEach(c => {
      const [, k, neg, vs] = c.dataset.when.match(/^(\w+)(!?)=(.*)$/) || [];
      const v = val(f, k); const hit = vs.split('|').includes(v);
      c.hidden = neg ? hit : !hit;
    });
    $$('input,select,textarea', f).forEach(i => { if (i.name === 'website') return; i.disabled = !!i.closest('.cond[hidden]'); });
  };
  const visible = e => !e.disabled && !e.closest('[hidden]');
  const validate = (scope) => {
    let ok = true;
    $$('.fld', scope).forEach(l => {
      const i = l.querySelector('input,textarea,select'); const m = l.querySelector('.err-msg'); if (!i || !m || !visible(i)) { l.classList.remove('bad'); return; }
      let msg = '';
      if (i.required && !i.value.trim() && i.type !== 'file') msg = 'Please fill this in.';
      else if (i.type === 'file' && i.required && !i.files.length) msg = 'Please attach a file.';
      else if (i.type === 'email' && i.value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(i.value)) msg = 'Please check the email address.';
      else if (i.type === 'tel' && i.value && i.value.replace(/\D/g, '').length < 7) msg = 'Please check the number.';
      else if (i.type === 'url' && i.value && !/^https?:\/\/\S+\.\S+/.test(i.value)) msg = 'Please enter a full link starting with https://';
      else if (i.type === 'file' && i.files[0] && i.files[0].size > 10 * 1024 * 1024) msg = 'File is larger than 10 MB.';
      m.textContent = msg; l.classList.toggle('bad', !!msg); if (msg) ok = false;
    });
    $$('fieldset[data-req]', scope).forEach(fs => { const ins = $$('input', fs).filter(visible); if (!ins.length) return; const m = fs.querySelector('.err-msg'); const bad = !ins.some(i => i.checked); fs.classList.toggle('bad', bad); if (m) m.textContent = bad ? 'Please choose one.' : ''; if (bad) ok = false; });
    $$('label.check input[required]', scope).filter(visible).forEach(c => { c.closest('label').classList.toggle('bad', !c.checked); if (!c.checked) ok = false; });
    if (!ok) { const first = scope.querySelector('.bad input,.bad textarea,.bad select'); first && first.focus({ preventScroll: true }); first && first.closest('.fld,fieldset,label').scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    return ok;
  };
  const TITLES = { portal: 'Registration received', contact: 'Message sent', product: 'Request received', shop: 'Request received', claim: 'Claim received', career: 'Application received', payment: 'Message sent', whistleblowing: 'Report received', kyc: 'Application received' };
  const NEXT = { portal: 'We will verify your details and email you once your client portal access is ready.', career: 'Our HR team reviews every application and will contact you if there is a match.', whistleblowing: 'Your report will be handled confidentially by our compliance team.', claim: 'A claims officer will contact you within one business day.', kyc: 'Our team will review your application and send your quotation and payment instructions by email.' };
  const COLS = ['name', 'email', 'phone', 'company', 'topic', 'message', 'consent', 'website', 'anonymous', 'declare'];

  $$('[data-form]').forEach(el => {
    const kind = el.dataset.form;
    const wizard = kind === 'kyc' || kind === 'portal';
    const inner = kind === 'portal' ? portalSteps(el) : wizard ? kycSteps(el) : (LAYOUTS[kind] || LAYOUTS.contact)(el);
    const tail = (wizard ? '' : (SUBMIT_WHEN[kind] ? when(SUBMIT_WHEN[kind], CONSENT) : CONSENT)) +
      (wizard ? `<div class="full actions wiz-nav"><button class="btn btn-ghost" type="button" data-back>Back</button><button class="btn" type="button" data-next>Continue</button><button class="btn btn-orange" type="submit">${kind === 'portal' ? 'Submit registration' : LABEL_SUBMIT.kyc}</button><p class="form-msg" role="status"></p></div>`
        : (SUBMIT_WHEN[kind] ? when(SUBMIT_WHEN[kind], `<div class="actions"><button class="btn" type="submit">${LABEL_SUBMIT[kind] || 'Send'}</button><p class="form-msg" role="status"></p></div>`) : `<div class="full actions"><button class="btn" type="submit">${LABEL_SUBMIT[kind] || 'Send'}</button><p class="form-msg" role="status"></p></div>`));
    el.innerHTML = `<form class="tform${wizard ? ' wizard' : ''}" novalidate>${isTest ? '<p class="test-flag full">Test site: submissions here are marked TEST.</p>' : ''}${wizard ? '<ol class="wiz-progress full" aria-hidden="true"></ol>' : ''}${inner}<input type="text" name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">${tail}</form>`;
    const f = $('form', el);
    const msg = () => $('.form-msg', f);
    const anon = f.querySelector('input[name=anonymous]');
    anon && anon.addEventListener('change', () => { f.querySelector('.who').hidden = anon.checked; });
    refresh(f);
    f.addEventListener('change', () => refresh(f));
    f.addEventListener('input', e => { const l = e.target.closest('.fld,fieldset'); if (l && l.classList.contains('bad')) validate(l.parentElement); });

    // wizard
    let cur = 0; const steps = $$('.kstep', f);
    const review = () => {
      const box = $('.kreview', f); if (!box) return;
      box.innerHTML = steps.slice(0, -1).map((s, i) => {
        const items = $$('.fld,fieldset', s).filter(x => !x.closest('.cond[hidden]')).map(x => {
          const lab = (x.querySelector('span,legend') || {}).textContent || ''; const ins = $$('input,select,textarea', x).filter(i => !i.disabled); if (!ins.length) return '';
          let v = ins[0].type === 'file' ? (ins[0].files[0] ? ins[0].files[0].name : '') : ['radio', 'checkbox'].includes(ins[0].type) ? ins.filter(i => i.checked).map(i => i.value).join(', ') : ins[0].value;
          return v ? `<div><dt>${esc(lab.replace('(optional)', '').trim())}</dt><dd>${esc(v)}</dd></div>` : '';
        }).join('');
        return items ? `<div class="rv"><div class="rv-h"><strong>${esc(s.dataset.title)}</strong><button type="button" class="link" data-go="${i}">Edit</button></div><dl>${items}</dl></div>` : '';
      }).join('');
    };
    const go = (n, silent) => {
      cur = Math.max(0, Math.min(steps.length - 1, n));
      steps.forEach((s, i) => s.hidden = i !== cur);
      const p = $('.wiz-progress', f); if (p) p.innerHTML = steps.map((s, i) => `<li class="${i < cur ? 'done' : i === cur ? 'on' : ''}"><span>${i + 1}</span><em>${esc(s.dataset.title)}</em></li>`).join('');
      const back = $('[data-back]', f), next = $('[data-next]', f), sub = $('button[type=submit]', f);
      if (back) back.hidden = cur === 0; if (next) next.hidden = cur === steps.length - 1; if (sub) sub.hidden = cur !== steps.length - 1;
      if (cur === steps.length - 1) review();
      if (wizard && !silent) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    if (wizard) {
      go(0, true);
      f.addEventListener('click', e => {
        if (e.target.closest('[data-next]')) { if (validate(steps[cur])) go(cur + 1); }
        else if (e.target.closest('[data-back]')) go(cur - 1);
        else if (e.target.closest('[data-go]')) go(+e.target.closest('[data-go]').dataset.go);
      });
      f.addEventListener('change', e => { if (cur === 0 && (e.target.name === 'product' || e.target.name === 'account_type')) setTimeout(() => go(1), 250); });
    }

    f.addEventListener('submit', async e => {
      e.preventDefault();
      if (!validate(wizard ? steps[cur] : f)) return;
      const fd = new FormData(f), d = {}, details = {};
      for (const [k, v] of fd.entries()) { if (v instanceof File) continue; d[k] = d[k] ? d[k] + ', ' + v : v; }
      if (d.website) return; // spam trap
      for (const [k, v] of Object.entries(d)) if (!COLS.includes(k) && v !== '') details[k] = v;
      const btn = $('button[type=submit]', f); const label = btn.textContent; btn.disabled = true; btn.textContent = 'Sending…';
      const m = msg(); if (m) { m.className = 'form-msg'; m.textContent = ''; }
      const ref = (kind === 'portal' ? 'CP-' : wizard ? 'KYC-' : 'TRN-') + Date.now().toString(36).toUpperCase().slice(-6);
      const name = d.name || [d.first_name, d.middle_name, d.last_name, d.suffix].filter(Boolean).join(' ') || null;
      try {
        const attachments = {}; let uploadIssue = false;
        for (const fi of $$('input[type=file]', f).filter(visible)) {
          if (!fi.files[0]) continue;
          try { attachments[fi.dataset.label || fi.name] = await sbUpload(fi.files[0], kind); } catch (x) { uploadIssue = true; }
        }
        const anonymous = d.anonymous === 'yes';
        const subject = d.topic || d.product || d.claim_type || d.subject || null;
        await sbInsert('inquiries', {
          kind, name: anonymous ? null : name, email: anonymous ? null : (d.email || null), phone: d.phone || null,
          company: d.company || null, subject: kind === 'portal' ? `Client portal registration – ${d.account_type || ''}` : wizard ? `${d.product} insurance application` : subject, message: d.message || null, page: location.pathname,
          payload: { ref, test: isTest, site: location.hostname, anonymous, details, attachments, uploads_pending: uploadIssue }
        });
        const first = (d.first_name || (name || '').split(' ')[0] || '');
        el.innerHTML = `<div class="form-done"><div class="tick" aria-hidden="true">✓</div><h3>${TITLES[kind] || 'Message sent'}</h3><p>Thank you${!anonymous && first ? ', ' + esc(first) : ''}. ${NEXT[kind] || 'Our team will get back to you within one business day.'}</p>${!anonymous && d.email ? `<p class="sent-to">We've emailed a confirmation to <strong>${esc(d.email)}</strong>. If it isn't in your inbox in a few minutes, please check your spam folder.</p>` : ''}${uploadIssue ? `<p class="muted">We couldn't upload some of your files. Please email them to <a href="mailto:trinity@trinity-insures.com">trinity@trinity-insures.com</a> with your reference number.</p>` : ''}<p class="muted">Reference: <strong>${ref}</strong>${isTest ? ' · TEST submission' : ''}</p></div>`;
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch (x) {
        btn.disabled = false; btn.textContent = label;
        const m2 = msg(); if (m2) { m2.className = 'form-msg err'; m2.innerHTML = esc(x.message) + ` You can also email <a href="mailto:trinity@trinity-insures.com">trinity@trinity-insures.com</a> or call +632 8810 1653.`; }
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

// Claims: interactive document checklists + print
(function () {
  var lists = document.querySelectorAll('.cg-body .checklist');
  lists.forEach(function (ol, n) {
    var items = ol.querySelectorAll(':scope > li');
    items.forEach(function (li, i) {
      var id = 'ck' + n + '-' + i, cb = document.createElement('input');
      cb.type = 'checkbox'; cb.id = id; cb.className = 'ck';
      var lab = document.createElement('label'); lab.htmlFor = id; lab.className = 'ck-box'; lab.setAttribute('aria-label', 'Mark as ready');
      li.prepend(lab); li.prepend(cb);
      cb.addEventListener('change', function () { li.classList.toggle('ready', cb.checked); count(); });
    });
    var c = document.createElement('p'); c.className = 'ck-count'; ol.before(c);
    function count() { var t = items.length, d = ol.querySelectorAll(':scope > li > .ck:checked').length; c.innerHTML = '<span style="--p:' + (d / t * 100) + '%"></span>' + d + ' of ' + t + ' ready'; c.classList.toggle('all', d === t); }
    count();
  });
  document.querySelectorAll('[data-print]').forEach(function (b) { b.addEventListener('click', function () { window.print(); }); });
})();
