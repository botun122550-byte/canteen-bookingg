import { supabase } from './supabaseClient'

// ส่งคำขอแจ้งเตือน Telegram ไปที่ /api/notify
// ถ้าพลาดจะไม่ทำให้การสั่งอาหารล้มเหลว
export async function notify(payload) {
  try {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token) return
    await fetch('/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    })
  } catch (e) {
    console.error('notify failed', e)
  }
}
