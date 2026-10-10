import crypto from 'node:crypto'

// ใช้ฝั่งเซิร์ฟเวอร์เท่านั้น (API routes) ห้าม import จากหน้าเว็บ

function apiBase() {
  return `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`
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
  try {
    const body = { chat_id: chatId, text, disable_web_page_preview: true }
    if (buttonUrl) {
      body.reply_markup = {
        inline_keyboard: [[{ text: buttonText || 'เปิดเว็บ', url: buttonUrl }]],
      }
    }
    const res = await fetch(`${apiBase()}/sendMessage`, {
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
