-- Trinity website – Supabase schema (run once in the SQL editor)
create table if not exists public.inquiries (
  id bigint generated always as identity primary key,
  created_at timestamptz default now(),
  kind text not null default 'inquiry',      -- inquiry | product | claim | career | payment
  name text, email text, phone text, company text, subject text, message text, page text,
  payload jsonb default '{}'
);
create table if not exists public.newsletter_subscribers (
  id bigint generated always as identity primary key,
  created_at timestamptz default now(),
  email text unique not null
);
alter table public.inquiries enable row level security;
alter table public.newsletter_subscribers enable row level security;

-- Website visitors may only submit (insert). Nobody can read submissions with the public key;
-- view them in the Supabase dashboard (Table editor) or via authenticated staff later.
create policy "website can submit inquiries" on public.inquiries
  for insert to anon with check (char_length(coalesce(message,'')) < 5000);
create policy "website can subscribe" on public.newsletter_subscribers
  for insert to anon with check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');
