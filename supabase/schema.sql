-- รันไฟล์นี้ก่อน แล้วค่อยรัน seed.sql
-- วางใน Supabase > SQL Editor แล้วกด Run

create extension if not exists btree_gist;

create table tables (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  seats int not null default 4,
  zone text,
  created_at timestamptz default now()
);

create table reservations (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references tables(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  start_time timestamptz not null,
  end_time timestamptz not null,
  status text not null default 'booked',
  created_at timestamptz default now(),
  check (end_time > start_time),
  exclude using gist (
    table_id with =,
    tstzrange(start_time, end_time) with &&
  ) where (status = 'booked')
);

alter table tables enable row level security;
alter table reservations enable row level security;

create policy "ทุกคนดูโต๊ะได้" on tables
  for select using (true);

create policy "ล็อกอินแล้วดูการจองได้" on reservations
  for select using (auth.role() = 'authenticated');

create policy "จองในชื่อตัวเอง" on reservations
  for insert with check (auth.uid() = user_id);

create policy "ยกเลิกของตัวเอง" on reservations
  for update using (auth.uid() = user_id);
