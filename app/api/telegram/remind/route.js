// app/api/telegram/remind/route.js
// pg_cron เรียกทุกนาที: เตือนคนที่จองโต๊ะซึ่งจะหมดเวลาใน 10 นาที พร้อมปุ่มต่อเวลา
import { supabaseAdmin } from '../../../../lib/supabaseAdmin'
import { safeEqual, sendMessage } from '../../../../lib/telegram'
import { extendKeyboard, sendKeyboard } from '../../../../lib/telegramExtra'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request) {
  const secret = process.env.TELEGRAM_NOTIFY_SECRET
  const given = request.headers.get('x-webhook-secret') || ''
  if (!secret || !safeEqual(given, secret)) {
    return new Response('unauthorized', { status: 401 })
  }

  const db = supabaseAdmin()
  const now = new Date()
  const soon = new Date(now.getTime() + 10 * 60 * 1000)

  const { data: rows, error } = await db
    .from('reservations')
    .select('id, user_id, end_time, tables(name)')
    .eq('status', 'booked')
    .is('reminded_at', null)
    .gt('end_time', now.toISOString())
    .lte('end_time', soon.toISOString())

  if (error) {
    console.error('remind query error', error)
    return Response.json({ ok: false })
  }
  if (!rows || rows.length === 0) return Response.json({ ok: true, sent: 0 })

  // ทำเครื่องหมายก่อนส่ง กันส่งซ้ำถ้าถูกเรียกซ้อนกัน
  const { data: claimed } = await db
    .from('reservations')
    .update({ reminded_at: now.toISOString() })
    .in('id', rows.map((r) => r.id))
    .is('reminded_at', null)
    .select('id')
  const claimedIds = new Set((claimed || []).map((c) => c.id))

  const { data: links } = await db
    .from('telegram_links')
    .select('user_id, chat_id')
    .in('user_id', [...new Set(rows.map((r) => r.user_id))])
  const chatByUser = Object.fromEntries((links || []).map((l) => [l.user_id, l.chat_id]))

  let sent = 0
  for (const r of rows) {
    if (!claimedIds.has(r.id)) continue
    const chatId = chatByUser[r.user_id]
    if (!chatId) continue
    const t = new Date(r.end_time).toLocaleTimeString('th-TH', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Bangkok',
    })
    const text = `⏰ โต๊ะ ${r.tables?.name ?? ''} จะหมดเวลาจองเวลา ${t} น. (อีกไม่เกิน 10 นาที)\nถ้ายังใช้โต๊ะอยู่ กดต่อเวลาได้เลย (ถ้าไม่มีคนจองต่อ)`
    const res = await sendKeyboard(chatId, text, extendKeyboard(r.id))
    if (res.ok) sent += 1
    if (res.status === 403) await db.from('telegram_links').delete().eq('chat_id', chatId)
  }

  return Response.json({ ok: true, sent })
}
