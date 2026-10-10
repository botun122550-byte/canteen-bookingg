// lib/telegramExtra.js : ปุ่ม inline keyboard ของ Telegram (ให้ดาว, สลับเมนูหมด, ต่อเวลาจอง)

function token() {
  return (process.env.TELEGRAM_BOT_TOKEN || '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/^bot/i, '')
}

async function call(method, body) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token()}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return { ok: res.ok, status: res.status }
  } catch (err) {
    console.error('telegram call failed', method, err)
    return { ok: false, status: 0 }
  }
}

export function sendKeyboard(chatId, text, keyboard) {
  return call('sendMessage', { chat_id: chatId, text, reply_markup: { inline_keyboard: keyboard } })
}

export function editKeyboard(chatId, messageId, keyboard) {
  return call('editMessageReplyMarkup', {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: { inline_keyboard: keyboard },
  })
}

export function editText(chatId, messageId, text) {
  return call('editMessageText', { chat_id: chatId, message_id: messageId, text })
}

export function answerCallback(callbackQueryId, text) {
  return call('answerCallbackQuery', { callback_query_id: callbackQueryId, text })
}

export function sendRatingPrompt(chatId, orderId, shopName) {
  return sendKeyboard(chatId, `🍽 ได้รับอาหารจากร้าน${shopName}แล้ว ให้คะแนนร้านหน่อยนะครับ`, [
    [1, 2, 3, 4, 5].map((n) => ({ text: `${n}⭐`, callback_data: `rate:${orderId}:${n}` })),
  ])
}

export function extendKeyboard(reservationId) {
  return [[{ text: '⏱ ต่อเวลา 30 นาที', callback_data: `ext:${reservationId}` }]]
}
