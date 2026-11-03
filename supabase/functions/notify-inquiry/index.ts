// Supabase Edge Function: emails a notification for every new website submission.
// Trigger: Database Webhook on INSERT into public.inquiries -> this function.
// Secrets (set in Supabase → Edge Functions → Secrets, never in this repo):
//   RESEND_API_KEY   – email sending key
//   NOTIFY_TO        – comma-separated recipients
//   NOTIFY_FROM      – e.g. "Trinity Website <website@your-verified-domain>"
//   WEBHOOK_SECRET   – shared secret sent by the webhook in the x-webhook-secret header
const LABEL: Record<string, string> = {
  contact: 'Contact form', product: 'Product inquiry', shop: 'Shop inquiry', claim: 'Claim',
  career: 'Job application', payment: 'Payment inquiry', whistleblowing: 'Whistleblowing report',
};
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

Deno.serve(async (req) => {
  if (req.headers.get('x-webhook-secret') !== Deno.env.get('WEBHOOK_SECRET')) return new Response('forbidden', { status: 403 });
  const { record: r } = await req.json();
  if (!r) return new Response('no record', { status: 400 });
  const p = r.payload || {};
  const test = p.test === true;
  const kind = LABEL[r.kind] || r.kind;
  const subject = `${test ? '[TEST – staging site] ' : ''}${kind}${r.subject ? ': ' + r.subject : ''}${p.ref ? ' (' + p.ref + ')' : ''}`;
  const rows: [string, unknown][] = [
    ['Type', kind], ['Topic / product', r.subject], ['Name', p.anonymous ? 'Anonymous' : r.name], ['Email', r.email], ['Mobile', r.phone],
    ['Company', r.company], ['Policy no.', p.policy], ['Bike value', p.value], ['Brand / model', p.model],
    ['Message', r.message], ['Attachment', p.attachment ? `Supabase Storage → submissions/${p.attachment}` : null],
    ['Page', r.page], ['Submitted', new Date(r.created_at).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })], ['Reference', p.ref],
  ];
  const html = `${test ? '<p style="background:#fff4e5;padding:10px;border-radius:6px"><strong>TEST:</strong> sent from the staging site, not from a real visitor.</p>' : ''}
<table cellpadding="6" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px">${rows.filter(([, v]) => v).map(([k, v]) =>
  `<tr><td style="color:#666;vertical-align:top">${k}</td><td>${esc(v).replace(/\n/g, '<br>')}</td></tr>`).join('')}</table>`;
  const to = (Deno.env.get('NOTIFY_TO') || '').split(',').map(s => s.trim()).filter(Boolean);
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: Deno.env.get('NOTIFY_FROM'), to, subject, html, reply_to: !p.anonymous && r.email ? r.email : undefined }),
  });
  return new Response(await res.text(), { status: res.ok ? 200 : 502 });
});
