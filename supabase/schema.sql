-- ============================================================
-- Split-ez schema  (run in Supabase -> SQL Editor)
-- ============================================================

-- Each bill/outing.
create table if not exists sessions (
  id              uuid primary key default gen_random_uuid(),
  slug            text unique not null,
  title           text,
  bill_image_url  text,
  currency        text not null default 'INR',
  tax             numeric(12,2) not null default 0,          -- split proportionally
  service_charge  numeric(12,2) not null default 0,          -- split equally
  extras          numeric(12,2) not null default 0,          -- split equally (other charges)
  discount        numeric(12,2) not null default 0,          -- amount OFF the bill, split proportionally
  host_token      text not null,                             -- only the host knows this; gates edits
  published       boolean not null default false,
  created_at      timestamptz not null default now()
);

-- If you already created the sessions table before discounts existed, run:
--   alter table sessions add column if not exists discount numeric(12,2) not null default 0;

-- Saved address book of friends (shared, no login). Lets you reuse a
-- person's name + photo across many splits so faces show up automatically.
create table if not exists friends (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  photo_url   text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_friends_name on friends (lower(name));

-- People in the outing. photo_url is a denormalised snapshot so the split
-- page can show avatars without an extra join; friend_id links back to the
-- address book (nullable for ad-hoc names).
create table if not exists people (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references sessions(id) on delete cascade,
  name        text not null,
  photo_url   text,
  friend_id   uuid references friends(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- If you created people/claims before photos & fractional portions existed, run:
--   alter table people  add column if not exists photo_url text;
--   alter table people  add column if not exists friend_id uuid references friends(id) on delete set null;
--   alter table claims  alter column weight type numeric(8,4);

-- Line items from the bill.
create table if not exists items (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references sessions(id) on delete cascade,
  name        text not null,
  price       numeric(12,2) not null default 0,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

-- Who ate what, and how much. `weight` is the EXPLICIT FRACTION of the dish
-- this person ate (0.5 = half, 0.25 = a quarter). weight = 0 means "equal
-- share": split whatever is left after the explicit fractions equally.
create table if not exists claims (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references items(id) on delete cascade,
  person_id   uuid not null references people(id) on delete cascade,
  weight      numeric(8,4) not null default 0,
  created_at  timestamptz not null default now(),
  unique (item_id, person_id)
);

create index if not exists idx_people_session on people(session_id);
create index if not exists idx_items_session on items(session_id);
create index if not exists idx_claims_item on claims(item_id);
create index if not exists idx_claims_person on claims(person_id);

-- ------------------------------------------------------------
-- Realtime: broadcast claim changes so everyone sees live totals.
-- ------------------------------------------------------------
alter publication supabase_realtime add table claims;
alter publication supabase_realtime add table items;
alter publication supabase_realtime add table people;

-- ------------------------------------------------------------
-- Row Level Security
-- This app has no user logins; access is gated by the unguessable
-- slug + host_token, enforced in the API layer. For a friends-only
-- tool we keep RLS permissive. Tighten later if you add auth.
-- ------------------------------------------------------------
alter table sessions enable row level security;
alter table people  enable row level security;
alter table items   enable row level security;
alter table claims  enable row level security;
alter table friends enable row level security;

-- Allow read + claim operations from the anon key.
create policy "read sessions"  on sessions for select using (true);
create policy "read people"    on people  for select using (true);
create policy "read items"     on items   for select using (true);
create policy "read claims"    on claims  for select using (true);
-- The address book is searchable from the browser (anon key); writes
-- (creating a friend + uploading their photo) go through the service-role API.
create policy "read friends"   on friends for select using (true);

-- Friends can add/update/remove their own claims with the anon key.
create policy "write claims"   on claims  for insert with check (true);
create policy "update claims"  on claims  for update using (true);
create policy "delete claims"  on claims  for delete using (true);

-- NOTE: session/people/item writes go through server API routes using
-- the SERVICE ROLE key (never exposed to the browser), so no anon
-- insert/update policies are granted for those tables here.

-- ------------------------------------------------------------
-- Storage bucket for bill photos (also creatable via dashboard UI).
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('bills', 'bills', true)
on conflict (id) do nothing;

create policy "public read bills"
  on storage.objects for select
  using (bucket_id = 'bills');

-- ------------------------------------------------------------
-- Storage bucket for friend avatars.
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy "public read avatars"
  on storage.objects for select
  using (bucket_id = 'avatars');
