import { createClient } from '@supabase/supabase-js'

// ใช้ฝั่งเซิร์ฟเวอร์เท่านั้น (API routes) ห้าม import จากหน้าเว็บ
// คีย์นี้ข้าม RLS ได้ทั้งหมด เก็บไว้ใน Environment Variables ของ Vercel เท่านั้น
// ห้ามใส่ชื่อขึ้นต้นด้วย NEXT_PUBLIC_ และห้าม push ขึ้น GitHub

export function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('ยังไม่ได้ตั้งค่า SUPABASE_SERVICE_ROLE_KEY ใน Environment Variables')
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
