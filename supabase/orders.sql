-- เฟส 2: ร้านค้า เมนู และการสั่งอาหาร
-- วางใน Supabase > SQL Editor แล้วกด Run (รันครั้งเดียว)
-- ต้องรัน schema.sql ของเฟส 1 มาก่อนแล้ว

create table shops (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid references auth.users(id),
  is_open boolean not null default true,
  created_at timestamptz default now()
);

create table menu_items (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  name text not null,
  price numeric(8,2) not null check (price >= 0),
  is_available boolean not null default true,
  created_at timestamptz default now()
);

create table orders (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id),
  user_id uuid not null references auth.users(id),
  table_id uuid references tables(id),
  note text,
  status text not null default 'new'
    check (status in ('new', 'cooking', 'ready', 'done', 'cancelled')),
  total_price numeric(8,2) not null default 0,
  created_at timestamptz default now()
);

create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  menu_item_id uuid references menu_items(id) on delete set null,
  name text not null,
  price numeric(8,2) not null,
  quantity int not null check (quantity > 0)
);

alter table shops enable row level security;
alter table menu_items enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;

-- ร้านและเมนู: ทุกคนดูได้
create policy "ดูร้านได้" on shops for select using (true);
create policy "ดูเมนูได้" on menu_items for select using (true);

-- เจ้าของร้านเปิด/ปิดร้านของตัวเอง
create policy "เจ้าของร้านเปิดปิดร้าน" on shops
  for update using (owner_id = auth.uid());

-- เจ้าของร้านจัดการเมนูของร้านตัวเอง
create policy "เจ้าของร้านเพิ่มเมนู" on menu_items
  for insert with check (
    exists (select 1 from shops s where s.id = menu_items.shop_id and s.owner_id = auth.uid())
  );
create policy "เจ้าของร้านแก้เมนู" on menu_items
  for update using (
    exists (select 1 from shops s where s.id = menu_items.shop_id and s.owner_id = auth.uid())
  );
create policy "เจ้าของร้านลบเมนู" on menu_items
  for delete using (
    exists (select 1 from shops s where s.id = menu_items.shop_id and s.owner_id = auth.uid())
  );

-- ออเดอร์: ลูกค้าเห็นของตัวเอง เจ้าของร้านเห็นของร้านตัวเอง
create policy "ดูออเดอร์ของตัวเองหรือของร้านที่ดูแล" on orders
  for select using (
    user_id = auth.uid()
    or exists (select 1 from shops s where s.id = orders.shop_id and s.owner_id = auth.uid())
  );

create policy "เจ้าของร้านอัปเดตสถานะออเดอร์" on orders
  for update using (
    exists (select 1 from shops s where s.id = orders.shop_id and s.owner_id = auth.uid())
  );

create policy "ลูกค้ายกเลิกออเดอร์ที่ร้านยังไม่รับ" on orders
  for update
  using (user_id = auth.uid() and status = 'new')
  with check (user_id = auth.uid() and status = 'cancelled');

create policy "ดูรายการอาหารในออเดอร์" on order_items
  for select using (
    exists (
      select 1 from orders o
      where o.id = order_items.order_id
        and (
          o.user_id = auth.uid()
          or exists (select 1 from shops s where s.id = o.shop_id and s.owner_id = auth.uid())
        )
    )
  );

-- แก้ไขได้เฉพาะบางคอลัมน์ (กันการแก้ราคาหรือยอดรวม)
revoke update on orders from authenticated, anon;
grant update (status) on orders to authenticated;
revoke update on shops from authenticated, anon;
grant update (is_open) on shops to authenticated;

-- ฟังก์ชันสั่งอาหาร: คำนวณราคาจากเมนูในฐานข้อมูลเอง ไม่เชื่อราคาที่ส่งมาจากเบราว์เซอร์
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
  v_count int := 0;
  v_item record;
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

  for v_item in
    select m.id, m.name, m.price, (e->>'quantity')::int as quantity
    from jsonb_array_elements(p_items) e
    join menu_items m on m.id = (e->>'menu_item_id')::uuid
    where m.shop_id = p_shop_id and m.is_available
  loop
    if v_item.quantity < 1 or v_item.quantity > 20 then
      raise exception 'bad_quantity';
    end if;
    insert into order_items (order_id, menu_item_id, name, price, quantity)
    values (v_order_id, v_item.id, v_item.name, v_item.price, v_item.quantity);
    v_total := v_total + v_item.price * v_item.quantity;
    v_count := v_count + 1;
  end loop;

  if v_count <> jsonb_array_length(p_items) then
    raise exception 'item_unavailable';
  end if;

  update orders set total_price = v_total where id = v_order_id;
  return v_order_id;
end;
$$;

revoke all on function place_order(uuid, uuid, text, jsonb) from public;
grant execute on function place_order(uuid, uuid, text, jsonb) to authenticated;

-- เปิด Realtime
alter publication supabase_realtime add table orders;
alter publication supabase_realtime add table menu_items;
