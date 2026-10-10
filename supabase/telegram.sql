-- เฟส 6: แจ้งเตือนผ่าน Telegram
-- แก้ 2 ค่าในส่วน "ตั้งค่า" ด้านล่างให้ตรงของคุณก่อน แล้วค่อยกด Run
-- รันซ้ำได้ ถ้าต้องแก้ลิงก์หรือรหัสลับภายหลัง

-- ===== ตั้งค่า (แก้ 2 บรรทัดนี้) =====
-- 1) telegram_notify_url: ลิงก์เว็บของคุณบน Vercel ตามด้วย /api/telegram/notify
-- 2) telegram_notify_secret: ข้อความลับที่คุณตั้งเอง (ตัวอักษรและตัวเลขยาว ๆ)
--    ต้องตรงกับ TELEGRAM_NOTIFY_SECRET ที่ใส่ใน Vercel
create table if not exists app_settings (
  key text primary key,
  value text not null
);
alter table app_settings enable row level security;
revoke all on app_settings from anon, authenticated;

insert into app_settings (key, value) values
  ('telegram_notify_url', 'https://YOUR-SITE.vercel.app/api/telegram/notify'),
  ('telegram_notify_secret', 'CHANGE_ME')
on conflict (key) do update set value = excluded.value;
-- ===== จบส่วนตั้งค่า =====

-- การผูกบัญชีเว็บกับแชต Telegram
create table if not exists telegram_links (
  user_id uuid primary key references auth.users(id) on delete cascade,
  chat_id text not null,
  created_at timestamptz default now()
);

-- รหัสผูกบัญชีชั่วคราว (อายุ 10 นาที) เข้าถึงได้เฉพาะเซิร์ฟเวอร์
create table if not exists telegram_link_codes (
  code text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null
);

alter table telegram_links enable row level security;
alter table telegram_link_codes enable row level security;

drop policy if exists "ดูการผูก Telegram ของตัวเอง" on telegram_links;
create policy "ดูการผูก Telegram ของตัวเอง" on telegram_links
  for select using (user_id = auth.uid());

drop policy if exists "เลิกผูก Telegram ของตัวเอง" on telegram_links;
create policy "เลิกผูก Telegram ของตัวเอง" on telegram_links
  for delete using (user_id = auth.uid());

-- ขอรหัสผูกบัญชี (12 ตัว ใช้ในลิงก์ที่กดครั้งเดียวจบ)
create or replace function create_telegram_link_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  if auth.uid() is null then
    raise exception 'not_logged_in';
  end if;

  delete from telegram_link_codes where user_id = auth.uid() or expires_at < now();

  loop
    v_code := (
      select string_agg(
        substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), ''
      )
      from generate_series(1, 12)
    );
    begin
      insert into telegram_link_codes (code, user_id, expires_at)
      values (v_code, auth.uid(), now() + interval '10 minutes');
      return v_code;
    exception when unique_violation then
      null;
    end;
  end loop;
end;
$$;

revoke all on function create_telegram_link_code() from public;
grant execute on function create_telegram_link_code() to authenticated;

-- ส่งสัญญาณไปที่เว็บเมื่อมีออเดอร์ใหม่หรือสถานะเปลี่ยน
-- ถ้าส่งไม่สำเร็จ จะไม่กระทบการสั่งอาหาร
create extension if not exists pg_net with schema extensions;

create or replace function notify_telegram()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_secret text;
begin
  select value into v_url from app_settings where key = 'telegram_notify_url';
  select value into v_secret from app_settings where key = 'telegram_notify_secret';

  if v_url is null or v_secret is null or v_secret = 'CHANGE_ME' or v_url like '%YOUR-SITE%' then
    return new;
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
    body := jsonb_build_object(
      'type', tg_op,
      'record', to_jsonb(new),
      'old_record', case when tg_op = 'UPDATE' then to_jsonb(old) else null end
    )
  );
  return new;
exception when others then
  return new;
end;
$$;

drop trigger if exists orders_telegram_insert on orders;
create trigger orders_telegram_insert
  after insert on orders
  for each row execute function notify_telegram();

drop trigger if exists orders_telegram_status on orders;
create trigger orders_telegram_status
  after update of status on orders
  for each row
  when (old.status is distinct from new.status)
  execute function notify_telegram();

-- ถ้าเคยรัน line.sql ของเฟส 5 ไว้ บรรทัดนี้ปิดตัวส่ง LINE เดิม (ไม่เคยรันก็ไม่เป็นไร)
drop trigger if exists orders_line_insert on orders;
drop trigger if exists orders_line_status on orders;
