import crypto from 'node:crypto'

// ใช้ฝั่งเซิร์ฟเวอร์เท่านั้น (API routes) ห้าม import จากหน้าเว็บ

// อ่าน token จาก Environment Variable และล้างสิ่งที่มักติดมาตอนวาง
// (เว้นวรรค ขึ้นบรรทัดใหม่ เครื่องหมายคำพูด และคำว่า "bot" นำหน้า)
function getToken() {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || '')
    .trim()
    .replace(/^["']+|["']+$/g, '')
    .trim()
    .replace(/^bot/i, '')

  if (!token) {
    console.error('TELEGRAM_BOT_TOKEN is missing in this deployment')
    return ''
  }
  // token ที่ถูกต้องหน้าตา 123456789:AAxxxx
  if (!/^\d+:[\w-]+$/.test(token)) {
    console.error('TELEGRAM_BOT_TOKEN has an unexpected format (expected 123456789:AAxxxx)')
  }
  return token
}

function apiUrl(method) {
  return `https://api.telegram.org/bot${getToken()}/${method}`
}

// เทียบข้อความแบบกัน timing attack
export function safeEqual(x, y) {
  const a = Buffer.from(String(x))
  const b = Buffer.from(String(y))
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

// ส่งข้อความหาผู้ใช้ ถ้าใส่ buttonUrl จะมีปุ่มเปิดเว็บใต้ข้อความ
// คืนค่า { ok, status } ถ้า status เป็น 403 แปลว่าผู้ใช้บล็อกบอทแล้ว
export async function sendMessage(chatId, text, buttonUrl, buttonText) {
  if (!getToken()) return { ok: false, status: 0 }

  try {
    const body = { chat_id: chatId, text, disable_web_page_preview: true }
    if (buttonUrl) {
      body.reply_markup = {
        inline_keyboard: [[{ text: buttonText || 'เปิดเว็บ', url: buttonUrl }]],
      }
    }

    const res = await fetch(apiUrl('sendMessage'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      console.error('Telegram send failed', res.status, await res.text())
    }
    return { ok: res.ok, status: res.status }
  } catch (err) {
    console.error('Telegram send error', err)
    return { ok: false, status: 0 }
  }
}
