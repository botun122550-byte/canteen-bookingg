import { supabaseAdmin } from '../../../../lib/supabaseAdmin'
import { safeEqual, sendMessage } from '../../../../lib/telegram'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const baht = (n) => `฿${Number(n).toLocaleString('th-TH')}`

function siteUrl() {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, '')
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  }
  return ''
}

function itemLines(order) {
  return (order.order_items || [])
    .map((it) => `- ${it.name}${it.options ? ` (${it.options})` : ''} × ${it.quantity}`)
    .join('\n')
}

function whereText(order) {
  return order.tables?.name ? `ส่งที่โต๊ะ ${order.tables.name}` : 'ลูกค้ามารับที่ร้าน'
}

// สร้างรายการข้อความที่ต้องส่ง: [{ userId, text, path, label }]
function buildMessages(order, type, oldStatus) {
  const shortId = order.id.slice(0, 4).toUpperCase()
  const shopName = order.shops?.name ?? ''
  const ownerId = order.shops?.owner_id
  const out = []

  if (type === 'INSERT') {
    if (ownerId) {
      out.push({
        userId: ownerId,
        path: '/shop',
        label: 'เปิดหน้าร้าน',
        text:
          `🔔 ออเดอร์ใหม่ #${shortId}\n` +
          `${whereText(order)}\n` +
          `${itemLines(order)}\n` +
          (order.note ? `หมายเหตุ: ${order.note}\n` : '') +
          `รวม ${baht(order.total_price)}`,
      })
    }
    return out
  }

  if (type !== 'UPDATE' || order.status === oldStatus) return out

  if (order.status === 'cooking') {
    out.push({
      userId: order.user_id,
      path: '/order',
      label: 'ดูออเดอร์ของฉัน',
      text: `👩‍🍳 ร้าน${shopName}รับออเดอร์ #${shortId} แล้ว กำลังทำอาหาร`,
    })
  } else if (order.status === 'ready') {
    out.push({
      userId: order.user_id,
      path: '/order',
      label: 'ดูออเดอร์ของฉัน',
      text:
        `✅ ออเดอร์ #${shortId} จากร้าน${shopName} พร้อมรับแล้ว\n` +
        (order.tables?.name ? `ร้านจะส่งที่โต๊ะ ${order.tables.name}` : 'มารับที่ร้านได้เลยครับ'),
    })
  } else if (order.status === 'cancelled') {
    out.push({
      userId: order.user_id,
      path: '/order',
      label: 'ดูออเดอร์ของฉัน',
      text: `❌ ออเดอร์ #${shortId} จากร้าน${shopName} ถูกยกเลิกแล้ว`,
    })
    if (ownerId) {
      out.push({
        userId: ownerId,
        path: '/shop',
        label: 'เปิดหน้าร้าน',
        text: `❌ ออเดอร์ #${shortId} ถูกยกเลิก`,
      })
    }
  }
  return out
}

export async function POST(request) {
  const secret = process.env.TELEGRAM_NOTIFY_SECRET
  const given = request.headers.get('x-webhook-secret') || ''
  if (!secret || !safeEqual(given, secret)) {
    return new Response('unauthorized', { status: 401 })
  }

  let payload
  try {
    payload = await request.json()
  } catch {
    return new Response('bad json', { status: 400 })
  }

  const record = payload.record
  if (!record?.id) return Response.json({ ok: true, skipped: 'no record' })

  const db = supabaseAdmin()
  const { data: order, error } = await db
    .from('orders')
    .select(
      'id, status, total_price, note, user_id, tables(name), shops(name, owner_id), order_items(name, quantity, options)'
    )
    .eq('id', record.id)
    .single()

  if (error || !order) {
    console.error('notify: order not found', error)
    return Response.json({ ok: false })
  }

  const messages = buildMessages(order, payload.type, payload.old_record?.status)
  if (messages.length === 0) return Response.json({ ok: true, skipped: 'not needed' })

  const { data: links } = await db
    .from('telegram_links')
    .select('user_id, chat_id')
    .in('user_id', [...new Set(messages.map((m) => m.userId))])

  const chatByUser = Object.fromEntries((links || []).map((l) => [l.user_id, l.chat_id]))
  const base = siteUrl()
  let sent = 0

  for (const m of messages) {
    const chatId = chatByUser[m.userId]
    if (!chatId) continue
    const res = await sendMessage(chatId, m.text, base ? base + m.path : null, m.label)
    if (res.ok) sent += 1
    // 403 = ผู้ใช้บล็อกบอทแล้ว เลิกผูกให้อัตโนมัติ
    if (res.status === 403) {
      await db.from('telegram_links').delete().eq('chat_id', chatId)
    }
  }

  return Response.json({ ok: true, sent })
}
