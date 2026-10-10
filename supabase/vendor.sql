-- เฟส 4: ให้พ่อค้าแม่ค้าผูกบัญชีกับร้านเองด้วย "รหัสร้าน"
-- วางใน Supabase > SQL Editor แล้วกด Run (รันซ้ำได้ ไม่เป็นไร)

alter table shops add column if not exists claim_code text unique;

-- ซ่อนรหัสร้านจากการอ่านผ่านเว็บ (ใครเปิด DevTools ก็ดึงรหัสไม่ได้)
revoke select on shops from anon, authenticated;
grant select (id, name, owner_id, is_open, created_at) on shops to anon, authenticated;

-- ฟังก์ชันผูกบัญชี: รหัสใช้ได้ครั้งเดียว ใช้แล้วรหัสจะถูกลบทิ้ง
create or replace function claim_shop(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not_logged_in';
  end if;

  update shops
     set owner_id = auth.uid(),
         claim_code = null
   where claim_code is not null
     and claim_code = upper(trim(p_code))
     and owner_id is null
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function claim_shop(text) from public;
grant execute on function claim_shop(text) to authenticated;

-- สร้างรหัสให้ร้านที่ยังไม่มีเจ้าของ แล้วแสดงตารางรหัสของแต่ละร้าน
-- เพิ่มร้านใหม่ภายหลัง: insert into shops (name) values ('ชื่อร้าน');
-- แล้วรันสองคำสั่งด้านล่างนี้อีกครั้งเพื่อสร้างรหัสให้ร้านนั้น
update shops
   set claim_code = upper(substr(md5(random()::text || id::text), 1, 10))
 where owner_id is null
   and claim_code is null;

select name, claim_code
  from shops
 where claim_code is not null
 order by name;
