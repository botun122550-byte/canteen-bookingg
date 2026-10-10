// app/api/telegram/notify/route.js
import { supabaseAdmin } from '../../../../lib/supabaseAdmin'
import { safeEqual, sendMessage } from '../../../../lib/telegram'
import { sendRatingPrompt } from '../../../../lib/telegramExtra'

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
function buildMessages(order, type, old) {
  const ref = order.queue_no ? `คิว ${order.queue_no}` : `#${order.id.slice(0, 4).toUpperCase()}`
  const shopName = order.shops?.name ?? ''
  const ownerId = order.shops?.owner_id
  const out = []
  const toCustomer = (text) =>
    out.push({ userId: order.user_id, path: '/order', label: 'ดูออเดอร์ของฉัน', text })
  const toOwner = (text) => {
    if (ownerId) out.push({ userId: ownerId, path: '/shop', label: 'เปิดหน้าร้าน', text })
  }

  if (type === 'INSERT') {
    toOwner(
      `🔔 ออเดอร์ใหม่ ${ref}\n` +
        `${whereText(order)}\n` +
        `${itemLines(order)}\n` +
        (order.note ? `หมายเหตุ: ${order.note}\n` : '') +
        `รวม ${baht(order.total_price)}`
    )
    return out
  }

  if (type !== 'UPDATE') return out

  if (order.status !== old?.status) {
    if (order.status === 'cooking') {
      toCustomer(`👩‍🍳 ร้าน${shopName}รับออเดอร์ ${ref} แล้ว กำลังทำอาหาร`)
    } else if (order.status === 'ready') {
      toCustomer(
        `✅ ออเดอร์ ${ref} จากร้าน${shopName} พร้อมรับแล้ว\n` +
          (order.tables?.name ? `ร้านจะส่งที่โต๊ะ ${order.tables.name}` : 'มารับที่ร้านได้เลยครับ')
      )
    } else if (order.status === 'cancelled') {
      toCustomer(
        `❌ ออเดอร์ ${ref} จากร้าน${shopName} ถูกยกเลิกแล้ว` +
          (order.reject_reason ? `\nเหตุผล: ${order.reject_reason}` : '')
      )
      toOwner(`❌ ออเดอร์ ${ref} ถูกยกเลิก`)
    }
  }

  if (order.payment_status !== old?.payment_status) {
    if (order.payment_status === 'slip_sent') {
      toOwner(`💸 ลูกค้าแนบสลิปออเดอร์ ${ref} ยอด ${baht(order.total_price)} กรุณาตรวจสอบในหน้าร้าน`)
    } else if (order.payment_status === 'paid') {
      toCustomer(`✅ ร้าน${shopName}ยืนยันการชำระเงินออเดอร์ ${ref} แล้ว`)
    } else if (order.payment_status === 'unpaid' && old?.payment_status === 'slip_sent') {
      toCustomer(`⚠️ ร้าน${shopName}ตรวจสลิปออเดอร์ ${ref} ไม่ผ่าน กรุณาตรวจสอบแล้วแนบใหม่ในหน้าเว็บ`)
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
      'id, status, total_price, note, user_id, queue_no, reject_reason, payment_status, tables(name), shops(name, owner_id), order_items(name, quantity, options)'
    )
    .eq('id', record.id)
    .single()

  if (error || !order) {
    console.error('notify: order not found', error)
    return Response.json({ ok: false })
  }

  const old = payload.old_record
  const messages = buildMessages(order, payload.type, old)
  const askRating = payload.type === 'UPDATE' && order.status === 'done' && old?.status !== 'done'
  if (messages.length === 0 && !askRating) return Response.json({ ok: true, skipped: 'not needed' })

  const userIds = new Set(messages.map((m) => m.userId))
  if (askRating) userIds.add(order.user_id)

  const { data: links } = await db
    .from('telegram_links')
    .select('user_id, chat_id')
    .in('user_id', [...userIds])

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

  if (askRating && chatByUser[order.user_id]) {
    await sendRatingPrompt(chatByUser[order.user_id], order.id, order.shops?.name ?? '')
  }

  return Response.json({ ok: true, sent })
}
