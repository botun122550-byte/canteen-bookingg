import { supabaseAdmin } from '../../../../lib/supabaseAdmin'
import { safeEqual, sendMessage } from '../../../../lib/telegram'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CODE_RE = /^[A-Z0-9]{12}$/

const HELP =
  'สวัสดีครับ บอทนี้แจ้งเตือนออเดอร์ของเว็บโรงอาหาร ให้กดปุ่ม "ผูกบัญชี Telegram" ในหน้าเว็บ แล้วกดลิงก์ที่ได้ ระบบจะผูกบัญชีให้เอง'

export async function POST(request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET
  const given = request.headers.get('x-telegram-bot-api-secret-token') || ''
  if (!secret || !safeEqual(given, secret)) {
    return new Response('unauthorized', { status: 401 })
  }

  let update
  try {
    update = await request.json()
  } catch {
    return new Response('bad json', { status: 400 })
  }

  try {
    await handleUpdate(supabaseAdmin(), update)
  } catch (err) {
    console.error('telegram update error', err)
  }
  // ตอบ 200 เสมอ ไม่งั้น Telegram จะส่งซ้ำ
  return Response.json({ ok: true })
}

async function handleUpdate(db, update) {
  // ผู้ใช้บล็อกบอท: เลิกผูกเพื่อไม่ให้ส่งไปเปล่า ๆ
  const member = update.my_chat_member
  if (
    member &&
    member.chat?.type === 'private' &&
    ['kicked', 'left'].includes(member.new_chat_member?.status)
  ) {
    await db.from('telegram_links').delete().eq('chat_id', String(member.chat.id))
    return
  }

  const msg = update.message
  if (!msg || msg.chat?.type !== 'private' || typeof msg.text !== 'string') return

  const chatId = String(msg.chat.id)

  // รับทั้ง "/start CODE" (จากลิงก์) และการพิมพ์รหัสเอง
  const raw = msg.text.replace(/^\/start(?:@\w+)?\s*/, '').trim().toUpperCase()
  if (!CODE_RE.test(raw)) {
    await sendMessage(chatId, HELP)
    return
  }

  const { data: row } = await db
    .from('telegram_link_codes')
    .select('code, user_id, expires_at')
    .eq('code', raw)
    .maybeSingle()

  if (!row || new Date(row.expires_at) < new Date()) {
    await sendMessage(chatId, 'รหัสไม่ถูกต้องหรือหมดอายุแล้ว กดขอรหัสใหม่ในหน้าเว็บได้เลยครับ')
    return
  }

  const { error } = await db
    .from('telegram_links')
    .upsert({ user_id: row.user_id, chat_id: chatId }, { onConflict: 'user_id' })

  if (error) {
    console.error('telegram link error', error)
    await sendMessage(chatId, 'ผูกบัญชีไม่สำเร็จ ลองขอรหัสใหม่อีกครั้งนะครับ')
    return
  }

  await db.from('telegram_link_codes').delete().eq('code', raw)
  await sendMessage(chatId, '✅ ผูกบัญชี Telegram สำเร็จแล้ว ต่อไปจะแจ้งเตือนผ่านแชตนี้ครับ')
}
