import { supabaseAdmin } from '../../../../lib/supabaseAdmin'
import { safeEqual, sendMessage } from '../../../../lib/telegram'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// เตือนเมื่อเหลือเวลาจองไม่เกินกี่นาที
const REMIND_BEFORE_MIN = 10

function siteUrl() {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, '')
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  }
  return ''
}

const timeTH = (iso) =>
  new Intl.DateTimeFormat('th-TH', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Bangkok',
  }).format(new Date(iso))

export async function POST(request) {
  const secret = process.env.TELEGRAM_NOTIFY_SECRET
  const given = request.headers.get('x-webhook-secret') || ''
  if (!secret || !safeEqual(given, secret)) {
    return new Response('unauthorized', { status: 401 })
  }

  const db = supabaseAdmin()
  const now = new Date()
  const limit = new Date(now.getTime() + REMIND_BEFORE_MIN * 60000)

  // การจองที่ยังใช้งานอยู่ ใกล้หมดเวลา และยังไม่เคยเตือน
  const { data: rows, error } = await db
    .from('reservations')
    .select('id, user_id, end_time, tables(name)')
    .eq('status', 'booked')
    .is('reminded_at', null)
    .gt('end_time', now.toISOString())
    .lte('end_time', limit.toISOString())

  if (error) {
    console.error('remind: query failed', error)
    return Response.json({ ok: false }, { status: 500 })
  }
  if (!rows || rows.length === 0) return Response.json({ ok: true, found: 0, sent: 0 })

  const { data: links } = await db
    .from('telegram_links')
    .select('user_id, chat_id')
    .in('user_id', [...new Set(rows.map((r) => r.user_id))])
  const chatByUser = Object.fromEntries((links || []).map((l) => [l.user_id, l.chat_id]))

  const base = siteUrl()
  let sent = 0

  for (const r of rows) {
    // จองสิทธิ์ส่งก่อน (กันส่งซ้ำถ้า job รันซ้อนกัน)
    const { data: claimed } = await db
      .from('reservations')
      .update({ reminded_at: now.toISOString() })
      .eq('id', r.id)
      .is('reminded_at', null)
      .select('id')
    if (!claimed || claimed.length === 0) continue

    const chatId = chatByUser[r.user_id]
    if (!chatId) continue

    const minLeft = Math.max(1, Math.ceil((new Date(r.end_time).getTime() - now.getTime()) / 60000))
    const text =
      `⏰ โต๊ะ ${r.tables?.name ?? ''} ของคุณจะหมดเวลาในอีกประมาณ ${minLeft} นาที (เวลา ${timeTH(r.end_time)} น.)\n` +
      `ถ้ายังนั่งต่อ เข้าไปจองเพิ่มได้เลยครับ`

    const res = await sendMessage(chatId, text, base ? `${base}/book` : null, 'เปิดหน้าจองโต๊ะ')
    if (res.ok) sent += 1
    if (res.status === 403) {
      await db.from('telegram_links').delete().eq('chat_id', chatId)
    }
  }

  return Response.json({ ok: true, found: rows.length, sent })
}
