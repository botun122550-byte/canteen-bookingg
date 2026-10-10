import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STATUS_TEXT = {
  cooking: '👨‍🍳 ร้านรับออเดอร์แล้ว กำลังทำ',
  ready: '✅ อาหารพร้อมรับแล้ว',
  done: '🎉 ออเดอร์เสร็จสิ้น',
  cancelled: '❌ ออเดอร์ถูกยกเลิก',
}

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  )
}

async function sendTelegram(chatId, text) {
  const res = await fetch(
    `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    }
  )
  if (!res.ok) console.error('telegram sendMessage failed', res.status, await res.text())
  return res.ok
}

async function chatIdOf(db, userId) {
  if (!userId) return null
  const { data } = await db
    .from('telegram_links')
    .select('chat_id')
    .eq('user_id', userId)
    .maybeSingle()
  return data?.chat_id ?? null
}

const ORDER_SELECT =
  'id, user_id, shop_id, status, total_price, note, created_at, shops(name, owner_id), tables(name), order_items(name, quantity, options)'

function orderText(o) {
  const lines = (o.order_items || [])
    .map((it) => `• ${it.name}${it.options ? ` (${it.options})` : ''} × ${it.quantity}`)
    .join('\n')
  const where = o.tables?.name ? `ส่งที่โต๊ะ ${o.tables.name}` : 'มารับที่ร้าน'
  return `${lines}\n${where}\nรวม ฿${Number(o.total_price).toLocaleString('th-TH')}${
    o.note ? `\nหมายเหตุ: ${o.note}` : ''
  }`
}

export async function POST(req) {
  try {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    if (!token) return NextResponse.json({ error: 'no_token' }, { status: 401 })

    const db = admin()
    const { data: auth } = await db.auth.getUser(token)
    const user = auth?.user
    if (!user) return NextResponse.json({ error: 'bad_token' }, { status: 401 })

    const { type, orderId, shopId } = await req.json()

    // หาออเดอร์ (ถ้าไม่ส่ง orderId มา ใช้ออเดอร์ล่าสุดของผู้ใช้ในร้านนั้น)
    let query = db.from('orders').select(ORDER_SELECT)
    if (orderId) {
      query = query.eq('id', orderId)
    } else if (type === 'new_order' && shopId) {
      query = query.eq('user_id', user.id).eq('shop_id', shopId).order('created_at', { ascending: false }).limit(1)
    } else {
      return NextResponse.json({ error: 'bad_request' }, { status: 400 })
    }
    const { data: rows, error } = await query
    const order = rows?.[0]
    if (error || !order) {
      console.error('notify: order not found', error)
      return NextResponse.json({ error: 'order_not_found' }, { status: 404 })
    }

    const isCustomer = order.user_id === user.id
    const isOwner = order.shops?.owner_id === user.id

    if (type === 'new_order') {
      if (!isCustomer) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
      const chatId = await chatIdOf(db, order.shops?.owner_id)
      if (!chatId) {
        console.error('notify: shop owner has no telegram link', order.shop_id)
        return NextResponse.json({ ok: false, reason: 'owner_not_linked' })
      }
      const ok = await sendTelegram(chatId, `🔔 ออเดอร์ใหม่ ร้าน${order.shops?.name}\n${orderText(order)}`)
      return NextResponse.json({ ok })
    }

    if (type === 'status_changed') {
      if (!isCustomer && !isOwner) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
      const label = STATUS_TEXT[order.status]
      if (!label) return NextResponse.json({ ok: true, skipped: true })

      // ลูกค้ายกเลิกเอง -> แจ้งร้าน, นอกนั้นแจ้งลูกค้า
      const toShop = order.status === 'cancelled' && isCustomer
      const chatId = await chatIdOf(db, toShop ? order.shops?.owner_id : order.user_id)
      if (!chatId) return NextResponse.json({ ok: false, reason: 'not_linked' })
      const ok = await sendTelegram(chatId, `${label}\nร้าน${order.shops?.name}\n${orderText(order)}`)
      return NextResponse.json({ ok })
    }

    return NextResponse.json({ error: 'bad_type' }, { status: 400 })
  } catch (e) {
    console.error('notify error', e)
    return NextResponse.json({ error: 'server_error' }, { status: 500 })
  }
}
