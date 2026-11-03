-- Trinity website – file attachments for the Claims, Careers and Whistleblowing forms.
-- Run once in the Supabase SQL editor (project "Trinity").
-- Creates a PRIVATE bucket: visitors can upload, but nobody can list or download files with the public key.
-- Staff view the files in the Supabase dashboard (Storage → submissions).
insert into storage.buckets (id, name, public, file_size_limit)
values ('submissions', 'submissions', false, 10485760)
on conflict (id) do nothing;

create policy "website can upload submissions" on storage.objects
  for insert to anon
  with check (bucket_id = 'submissions' and (storage.foldername(name))[1] in ('claim','career','whistleblowing'));

-- Email notifications (next step, needs an email-sending key, so not included here):
-- Supabase Dashboard → Database → Webhooks → on INSERT into public.inquiries → call an Edge Function
-- that emails trinity@trinity-insures.com (e.g. via Resend). Route by "kind": claim → claims team,
-- career → HR, whistleblowing → compliance, everything else → trinity@.
