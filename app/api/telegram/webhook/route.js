// app/api/telegram/webhook/route.js
import { supabaseAdmin } from '../../../../lib/supabaseAdmin'
import { safeEqual, sendMessage } from '../../../../lib/telegram'
import {
  answerCallback,
  editKeyboard,
  editText,
  sendKeyboard,
} from '../../../../lib/telegramExtra'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CODE_RE = /^[A-Z0-9]{12}$/
const UUID = '[0-9a-fA-F-]{36}'

const HELP =
  'สวัสดีครับ บอทนี้แจ้งเตือนออเดอร์ของเว็บโรงอาหาร ให้กดปุ่ม "ผูกบัญชี Telegram" ในหน้าเว็บ แล้วกดลิงก์ที่ได้ ระบบจะผูกบัญชีให้เอง\nเจ้าของร้านพิมพ์ /menu เพื่อเปิด/ปิดเมนูที่หมดได้'

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

async function userIdByChat(db, chatId) {
  const { data } = await db.from('telegram_links').select('user_id').eq('chat_id', chatId).maybeSingle()
  return data?.user_id ?? null
}

// ===== แผงเปิด/ปิดเมนูสำหรับเจ้าของร้าน =====
async function menuKeyboard(db, userId) {
  const { data: shops } = await db.from('shops').select('id').eq('owner_id', userId)
  const ids = (shops || []).map((s) => s.id)
  if (ids.length === 0) return null
  const { data: items } = await db
    .from('menu_items')
    .select('id, name, is_available')
    .in('shop_id', ids)
    .order('name')
    .limit(40)
  return (items || []).map((i) => [
    { text: `${i.is_available ? '🟢' : '🔴'} ${i.name}`, callback_data: `mi:${i.id}` },
  ])
}

async function sendMenuPanel(db, chatId) {
  const userId = await userIdByChat(db, chatId)
  if (!userId) return sendMessage(chatId, 'ยังไม่ได้ผูกบัญชี Telegram กับเว็บ')
  const kb = await menuKeyboard(db, userId)
  if (!kb) return sendMessage(chatId, 'บัญชีนี้ยังไม่ได้ผูกกับร้านค้า')
  if (kb.length === 0) return sendMessage(chatId, 'ร้านยังไม่มีเมนู')
  return sendKeyboard(chatId, 'แตะเมนูเพื่อสลับ มีขาย 🟢 / หมด 🔴', kb)
}

async function handleCallback(db, cb) {
  const chatId = String(cb.message?.chat?.id ?? '')
  const messageId = cb.message?.message_id
  const data = cb.data || ''
  if (!chatId) return
  const userId = await userIdByChat(db, chatId)
  if (!userId) return answerCallback(cb.id, 'ยังไม่ได้ผูกบัญชี')

  // ให้ดาวร้านหลังได้รับอาหาร
  let m = data.match(new RegExp(`^rate:(${UUID}):([1-5])$`))
  if (m) {
    const orderId = m[1]
    const rating = Number(m[2])
    const { data: order } = await db
      .from('orders')
      .select('id, user_id, status, shops(name)')
      .eq('id', orderId)
      .maybeSingle()
    if (!order || order.user_id !== userId || order.status !== 'done') {
      return answerCallback(cb.id, 'ให้คะแนนออเดอร์นี้ไม่ได้')
    }
    const { error } = await db
      .from('reviews')
      .upsert({ order_id: orderId, user_id: userId, rating }, { onConflict: 'order_id' })
    if (error) {
      console.error('review error', error)
      return answerCallback(cb.id, 'บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง')
    }
    await answerCallback(cb.id, `ให้ ${rating} ดาวแล้ว`)
    await editText(
      chatId,
      messageId,
      `⭐ ขอบคุณครับ ให้ร้าน${order.shops?.name ?? ''} ${rating} ดาว\n(เพิ่มความเห็นได้ที่หน้า "ออเดอร์ของฉัน")`
    )
    return
  }

  // เจ้าของร้านสลับเมนูมี/หมด
  m = data.match(new RegExp(`^mi:(${UUID})$`))
  if (m) {
    const { data: item } = await db
      .from('menu_items')
      .select('id, is_available, shops(owner_id)')
      .eq('id', m[1])
      .maybeSingle()
    if (!item || item.shops?.owner_id !== userId) return answerCallback(cb.id, 'ไม่มีสิทธิ์แก้เมนูนี้')
    const { error } = await db.from('menu_items').update({ is_available: !item.is_available }).eq('id', item.id)
    if (error) return answerCallback(cb.id, 'แก้เมนูไม่สำเร็จ')
    await answerCallback(cb.id, item.is_available ? 'ตั้งเป็นหมดแล้ว' : 'เปิดขายแล้ว')
    const kb = await menuKeyboard(db, userId)
    if (kb) await editKeyboard(chatId, messageId, kb)
    return
  }

  // ต่อเวลาจองโต๊ะ 30 นาที
  m = data.match(new RegExp(`^ext:(${UUID})$`))
  if (m) {
    const { data: r } = await db
      .from('reservations')
      .select('id, user_id, table_id, end_time, status')
      .eq('id', m[1])
      .maybeSingle()
    if (!r || r.user_id !== userId || r.status !== 'booked') return answerCallback(cb.id, 'ต่อเวลาไม่ได้')
    const oldEnd = new Date(r.end_time)
    if (oldEnd < new Date()) return answerCallback(cb.id, 'หมดเวลาจองไปแล้ว')
    const newEnd = new Date(oldEnd.getTime() + 30 * 60 * 1000)

    // โรงอาหารปิด 16:00 (ให้ตรงกับ CLOSE_HOUR ใน app/book/page.js)
    const bkk = new Date(newEnd.getTime() + 7 * 3600 * 1000)
    if (bkk.getUTCHours() * 60 + bkk.getUTCMinutes() > 16 * 60) {
      return answerCallback(cb.id, 'ต่อเวลาไม่ได้ เพราะเกินเวลาปิดโรงอาหาร')
    }

    const { data: clash } = await db
      .from('reservations')
      .select('id')
      .eq('table_id', r.table_id)
      .eq('status', 'booked')
      .neq('id', r.id)
      .lt('start_time', newEnd.toISOString())
      .gt('end_time', oldEnd.toISOString())
      .limit(1)
    if (clash && clash.length > 0) {
      return answerCallback(cb.id, 'โต๊ะมีคนจองต่อแล้ว ต่อเวลาไม่ได้')
    }

    const { error } = await db
      .from('reservations')
      .update({ end_time: newEnd.toISOString(), reminded_at: null })
      .eq('id', r.id)
    if (error) {
      console.error('extend error', error)
      return answerCallback(cb.id, 'ต่อเวลาไม่สำเร็จ')
    }
    const t = newEnd.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' })
    await answerCallback(cb.id, 'ต่อเวลาแล้ว')
    await editText(chatId, messageId, `✅ ต่อเวลาจองโต๊ะแล้ว ใช้โต๊ะได้ถึง ${t} น.`)
    return
  }

  return answerCallback(cb.id, '')
}

async function handleUpdate(db, update) {
  if (update.callback_query) {
    await handleCallback(db, update.callback_query)
    return
  }

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

  if (/^\/menu(?:@\w+)?$/i.test(msg.text.trim())) {
    await sendMenuPanel(db, chatId)
    return
  }

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
