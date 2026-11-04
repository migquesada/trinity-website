// Supabase Edge Function: emails Trinity about every new website submission,
// and sends the person who submitted a confirmation with their reference number.
// Trigger: Database Webhook on INSERT into public.inquiries -> this function.
// Secrets (set in Supabase → Edge Functions → Secrets, never in this repo):
//   NOTIFY_TO        – comma-separated recipients
//   WEBHOOK_SECRET   – shared secret sent by the webhook in the x-webhook-secret header
// Sending, option 1 (now): Gmail SMTP
//   SMTP_USER        – e.g. migquesada@gmail.com
//   SMTP_PASS        – a Google *App Password* (16 characters), not the normal password
//   SENDER_NAME      – sender name shown in the inbox, default "Trinity Insures"
//   CONFIRM_REPLY_TO – optional; where replies to confirmations go (default: first NOTIFY_TO)
//   SMTP_HOST / SMTP_PORT – optional, default smtp.gmail.com / 465
// Sending, option 2 (launch): Resend with the verified trinity-insures.com domain
//   RESEND_API_KEY, NOTIFY_FROM = "Trinity Website <trinity@trinity-insures.com>"
// If SMTP_USER is set, SMTP is used; otherwise Resend.
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';

const LABEL: Record<string, string> = {
  contact: 'Contact form', product: 'Product inquiry', shop: 'Shop inquiry', claim: 'Claim',
  career: 'Job application', payment: 'Payment inquiry', whistleblowing: 'Whistleblowing report',
  portal: 'Client portal registration', kyc: 'KYC form',
};
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const nice = (k: string) => k.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const val = (v: unknown) => Array.isArray(v) ? v.join(', ') : (v && typeof v === 'object' ? JSON.stringify(v) : v);

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
    ['Message', r.message],
  ];
  // Every other answer the form collected
  const shown = new Set(['name', 'email', 'phone', 'mobile', 'company', 'message']);
  for (const [k, v] of Object.entries(p.details || {})) if (!shown.has(k) && v !== '' && v != null) rows.push([nice(k), val(v)]);
  const att = p.attachments && typeof p.attachments === 'object' ? Object.entries(p.attachments) : [];
  if (p.attachment) att.push(['File', p.attachment]);
  if (att.length) rows.push(['Attachments', att.map(([k, f]) => `${k}: Supabase Storage → submissions/${f}`).join('\n')]);
  if (p.uploads_pending) rows.push(['Note', 'Some files could not be uploaded; ask the sender to email them.']);
  rows.push(['Page', r.page], ['Submitted', new Date(r.created_at).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })], ['Reference', p.ref]);

  const html = `${test ? '<p style="background:#fff4e5;padding:10px;border-radius:6px"><strong>TEST:</strong> sent from the staging site, not from a real visitor.</p>' : ''}
<table cellpadding="6" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px">${rows.filter(([, v]) => v).map(([k, v]) =>
  `<tr><td style="color:#666;vertical-align:top">${esc(k)}</td><td>${esc(v).replace(/\n/g, '<br>')}</td></tr>`).join('')}</table>`;
  const to = (Deno.env.get('NOTIFY_TO') || '').split(',').map(s => s.trim()).filter(Boolean);
  const replyTo = !p.anonymous && r.email ? r.email : undefined;

  // Confirmation to the person who submitted (skipped for anonymous reports or no email)
  const NEXT: Record<string, string> = {
    claim: 'A claims officer will contact you within one business day.',
    career: 'Our HR team reviews every application and will contact you if there is a match.',
    whistleblowing: 'Your report will be handled confidentially by our compliance team.',
    portal: 'We will verify your details and email you once your client portal access is ready.',
    kyc: 'Our team will review your application and send your quotation and payment instructions by email.',
  };
  const first = String(p.details?.first_name || (r.name || '').split(' ')[0] || '').trim();
  const confirmTo = !p.anonymous && r.email ? String(r.email).trim() : '';
  const hide = new Set(['Type', 'Page', 'Note', 'Attachments', 'Submitted', 'Reference']);
  const summary = r.kind === 'whistleblowing' ? [] : rows.filter(([k, v]) => v && !hide.has(k));
  const cSubject = `${test ? '[TEST] ' : ''}We received your ${kind.toLowerCase()}${p.ref ? ' – ' + p.ref : ''}`;
  const cHtml = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#1f2a33;max-width:600px;margin:auto">
${test ? '<p style="background:#fff4e5;padding:10px;border-radius:6px;font-size:13px"><strong>TEST:</strong> sent from the staging site.</p>' : ''}
<div style="background:#1c3d50;color:#fff;padding:18px 22px;border-radius:8px 8px 0 0"><strong style="font-size:18px;letter-spacing:.5px">TRINITY</strong><br><span style="font-size:12px;opacity:.8">Insurance Brokers Inc.</span></div>
<div style="border:1px solid #e3e8ec;border-top:0;padding:22px;border-radius:0 0 8px 8px">
<p>Hi${first ? ' ' + esc(first) : ''},</p>
<p>Thank you for reaching out. We received your ${esc(kind.toLowerCase())}${p.ref ? ` (reference <strong>${esc(p.ref)}</strong>)` : ''}.</p>
<p>${esc(NEXT[r.kind] || 'Our team will get back to you within one business day.')}</p>
${summary.length ? `<p style="margin-top:22px;color:#666;font-size:13px">What you sent us:</p><table cellpadding="6" style="border-collapse:collapse;font-size:14px;width:100%">${summary.map(([k, v]) =>
  `<tr style="border-top:1px solid #eef1f3"><td style="color:#666;vertical-align:top;width:38%">${esc(k)}</td><td>${esc(v).replace(/\n/g, '<br>')}</td></tr>`).join('')}</table>` : ''}
<p style="margin-top:22px">If anything needs correcting, just reply to this email.</p>
<p style="color:#666;font-size:13px;margin-top:22px">Trinity Insurance Brokers Inc.<br>+632 8810 1653 · trinity@trinity-insures.com<br>Mon–Fri, 8:30 AM – 5:30 PM</p>
</div></div>`;
  const confirmReplyTo = Deno.env.get('CONFIRM_REPLY_TO') || to[0];

  const name = Deno.env.get('SENDER_NAME') || 'Trinity Insures';
  const user = Deno.env.get('SMTP_USER');
  const results: string[] = [];
  if (user) {
    const client = new SMTPClient({
      connection: {
        hostname: Deno.env.get('SMTP_HOST') || 'smtp.gmail.com', port: Number(Deno.env.get('SMTP_PORT') || 465), tls: true,
        auth: { username: user, password: Deno.env.get('SMTP_PASS')! },
      },
    });
    try {
      await client.send({ from: `${name} <${user}>`, to, subject, html, content: 'auto', replyTo });
      results.push('team: sent');
      if (confirmTo) {
        try { await client.send({ from: `${name} <${user}>`, to: confirmTo, subject: cSubject, html: cHtml, content: 'auto', replyTo: confirmReplyTo }); results.push('confirmation: sent'); }
        catch (e) { results.push('confirmation error: ' + (e as Error).message); }
      }
      await client.close();
      console.log(results.join(' | '));
      return new Response(results.join('\n'), { status: 200 });
    } catch (e) {
      console.error('smtp error: ' + (e as Error).message);
      return new Response('smtp error: ' + (e as Error).message, { status: 502 });
    }
  }
  const send = (body: Record<string, unknown>) => fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: Deno.env.get('NOTIFY_FROM'), ...body }),
  });
  const res = await send({ to, subject, html, reply_to: replyTo });
  if (res.ok && confirmTo) await send({ to: confirmTo, subject: cSubject, html: cHtml, reply_to: confirmReplyTo });
  return new Response(await res.text(), { status: res.ok ? 200 : 502 });
});
