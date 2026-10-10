-- เฟส 3: ตัวเลือกเสริมในเมนู (พิเศษ เพิ่มไข่ เผ็ดน้อย ฯลฯ)
-- วางใน Supabase > SQL Editor แล้วกด Run (รันครั้งเดียว)
-- ต้องรัน orders.sql ของเฟส 2 มาก่อนแล้ว

create table menu_options (
  id uuid primary key default gen_random_uuid(),
  menu_item_id uuid not null references menu_items(id) on delete cascade,
  name text not null,
  extra_price numeric(8,2) not null default 0 check (extra_price >= 0),
  is_available boolean not null default true,
  created_at timestamptz default now()
);

-- เก็บตัวเลือกที่ลูกค้าเลือกไว้ในรายการอาหาร (เช่น "เพิ่มไข่ดาว, เผ็ดน้อย")
alter table order_items add column options text;

alter table menu_options enable row level security;

create policy "ดูตัวเลือกเสริมได้" on menu_options
  for select using (true);

create policy "เจ้าของร้านเพิ่มตัวเลือกเสริม" on menu_options
  for insert with check (
    exists (
      select 1 from menu_items mi
      join shops s on s.id = mi.shop_id
      where mi.id = menu_options.menu_item_id and s.owner_id = auth.uid()
    )
  );

create policy "เจ้าของร้านแก้ตัวเลือกเสริม" on menu_options
  for update using (
    exists (
      select 1 from menu_items mi
      join shops s on s.id = mi.shop_id
      where mi.id = menu_options.menu_item_id and s.owner_id = auth.uid()
    )
  );

create policy "เจ้าของร้านลบตัวเลือกเสริม" on menu_options
  for delete using (
    exists (
      select 1 from menu_items mi
      join shops s on s.id = mi.shop_id
      where mi.id = menu_options.menu_item_id and s.owner_id = auth.uid()
    )
  );

-- ฟังก์ชันสั่งอาหารเวอร์ชันใหม่: รองรับตัวเลือกเสริม
-- ราคาต่อจาน = ราคาเมนู + ราคาตัวเลือกที่เลือก คำนวณที่ฐานข้อมูลเอง
create or replace function place_order(
  p_shop_id uuid,
  p_table_id uuid,
  p_note text,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_total numeric := 0;
  v_el jsonb;
  v_menu record;
  v_qty int;
  v_option_ids uuid[];
  v_extra numeric;
  v_opt_text text;
  v_opt_found int;
  v_unit numeric;
begin
  if auth.uid() is null then
    raise exception 'not_logged_in';
  end if;

  if not exists (select 1 from shops where id = p_shop_id and is_open) then
    raise exception 'shop_closed';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'empty_order';
  end if;

  insert into orders (shop_id, user_id, table_id, note)
  values (p_shop_id, auth.uid(), p_table_id, nullif(trim(p_note), ''))
  returning id into v_order_id;

  for v_el in select value from jsonb_array_elements(p_items)
  loop
    select id, name, price into v_menu
    from menu_items
    where id = (v_el->>'menu_item_id')::uuid
      and shop_id = p_shop_id
      and is_available;

    if not found then
      raise exception 'item_unavailable';
    end if;

    v_qty := (v_el->>'quantity')::int;
    if v_qty is null or v_qty < 1 or v_qty > 20 then
      raise exception 'bad_quantity';
    end if;

    v_option_ids := array(
      select distinct x::uuid
      from jsonb_array_elements_text(coalesce(v_el->'option_ids', '[]'::jsonb)) as t(x)
    );

    select coalesce(sum(extra_price), 0),
           coalesce(string_agg(name, ', ' order by name), ''),
           count(*)
      into v_extra, v_opt_text, v_opt_found
    from menu_options
    where id = any(v_option_ids)
      and menu_item_id = v_menu.id
      and is_available;

    if v_opt_found <> coalesce(array_length(v_option_ids, 1), 0) then
      raise exception 'item_unavailable';
    end if;

    v_unit := v_menu.price + v_extra;

    insert into order_items (order_id, menu_item_id, name, price, quantity, options)
    values (v_order_id, v_menu.id, v_menu.name, v_unit, v_qty, nullif(v_opt_text, ''));

    v_total := v_total + v_unit * v_qty;
  end loop;

  update orders set total_price = v_total where id = v_order_id;
  return v_order_id;
end;
$$;

revoke all on function place_order(uuid, uuid, text, jsonb) from public;
grant execute on function place_order(uuid, uuid, text, jsonb) to authenticated;

-- เปิด Realtime ให้ตัวเลือกที่หมดอัปเดตทันที
alter publication supabase_realtime add table menu_options;
