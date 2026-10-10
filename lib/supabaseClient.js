import { createClient } from '@supabase/supabase-js'

// ค่าพวกนี้ตั้งใน .env.local (เครื่องตัวเอง) และใน Environment Variables ของ Vercel
// ห้ามใส่ค่าจริงลงในโค้ดหรือ push ไฟล์ .env.local ขึ้น GitHub
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)
