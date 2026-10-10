'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import styles from './TelegramLink.module.css'

// ชื่อผู้ใช้ของบอท (ไม่ต้องมี @) ตั้งใน Vercel เป็น NEXT_PUBLIC_TELEGRAM_BOT_USERNAME
const BOT = (process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || '').replace(/^@/, '')

const COPY = {
  shop: {
    title: 'แจ้งเตือนออเดอร์ใหม่ทาง Telegram',
    text: 'เมื่อมีคนสั่งอาหาร จะมีข้อความเด้งใน Telegram ทันที ไม่ต้องเปิดหน้าเว็บค้างไว้',
  },
  student: {
    title: 'แจ้งเตือนทาง Telegram',
    text: 'รับข้อความเมื่อร้านรับออเดอร์ ทำเสร็จ หรือยกเลิกออเดอร์ของคุณ',
  },
}

export default function TelegramLink({ userId, audience = 'student' }) {
  const copy = COPY[audience] || COPY.student
  const [linked, setLinked] = useState(null) // null = กำลังตรวจสอบ
  const [code, setCode] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const check = useCallback(async () => {
    const { data } = await supabase
      .from('telegram_links')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle()
    const ok = Boolean(data)
    setLinked(ok)
    return ok
  }, [userId])

  useEffect(() => {
    check()
  }, [check])

  // หลังขอรหัส ตรวจสถานะทุก 3 วินาทีจนกว่าจะผูกสำเร็จ
  useEffect(() => {
    if (!code || linked) return
    const timer = setInterval(async () => {
      if (await check()) setCode(null)
    }, 3000)
    return () => clearInterval(timer)
  }, [code, linked, check])

  async function requestCode() {
    setBusy(true)
    setError(null)
    const { data, error: err } = await supabase.rpc('create_telegram_link_code')
    setBusy(false)
    if (err || !data) {
      setError('ขอรหัสไม่สำเร็จ ลองใหม่อีกครั้ง')
      return
    }
    setCode(data)
  }

  async function unlink() {
    setBusy(true)
    setError(null)
    const { error: err } = await supabase.from('telegram_links').delete().eq('user_id', userId)
    setBusy(false)
    if (err) {
      setError('เลิกผูกไม่สำเร็จ ลองใหม่อีกครั้ง')
      return
    }
    setLinked(false)
    setCode(null)
  }

  if (linked === null) return null

  return (
    <section className={styles.card} aria-labelledby={`tg-${audience}`}>
      <h2 id={`tg-${audience}`} className={styles.title}>{copy.title}</h2>

      {linked ? (
        <>
          <p className={styles.ok}>เชื่อมต่อ Telegram แล้ว</p>
          <button className={styles.ghost} onClick={unlink} disabled={busy}>
            เลิกผูกบัญชี Telegram
          </button>
        </>
      ) : code ? (
        <>
          {BOT ? (
            <>
              <p className={styles.text}>
                กดปุ่มด้านล่างเพื่อเปิด Telegram แล้วกด START ในแชตของบอท ลิงก์ใช้ได้ 10 นาที
              </p>
              <a
                className={styles.primaryLink}
                href={`https://t.me/${BOT}?start=${code}`}
                target="_blank"
                rel="noreferrer"
              >
                เปิด Telegram เพื่อผูกบัญชี
              </a>
            </>
          ) : (
            <p className={styles.text}>
              เปิดแชตกับบอทของโรงอาหารใน Telegram แล้วส่งข้อความนี้ภายใน 10 นาที:{' '}
              <span className={styles.cmd}>/start {code}</span>
            </p>
          )}
          <p className={styles.text}>เมื่อผูกสำเร็จ หน้านี้จะเปลี่ยนสถานะเอง</p>
          <button className={styles.ghost} onClick={requestCode} disabled={busy}>
            ขอลิงก์ใหม่
          </button>
        </>
      ) : (
        <>
          <p className={styles.text}>{copy.text}</p>
          <button className={styles.primary} onClick={requestCode} disabled={busy}>
            ผูกบัญชี Telegram
          </button>
        </>
      )}

      {error && (
        <p role="status" className={styles.error}>
          {error}
        </p>
      )}
    </section>
  )
}
