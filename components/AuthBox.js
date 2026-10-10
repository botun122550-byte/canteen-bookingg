'use client'

import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import styles from './AuthBox.module.css'

export default function AuthBox({
  title = 'จองโต๊ะโรงอาหาร',
  subtitle = 'เข้าสู่ระบบด้วยอีเมลเพื่อจองโต๊ะ',
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  async function signIn() {
    setBusy(true)
    setMsg(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (error) setMsg({ type: 'error', text: 'เข้าสู่ระบบไม่สำเร็จ ตรวจสอบอีเมลและรหัสผ่านอีกครั้ง' })
  }

  async function signUp() {
    setBusy(true)
    setMsg(null)
    const { data, error } = await supabase.auth.signUp({ email, password })
    setBusy(false)
    if (error) {
      setMsg({ type: 'error', text: 'สมัครไม่สำเร็จ: ' + error.message })
    } else if (!data.session) {
      setMsg({ type: 'ok', text: 'ส่งอีเมลยืนยันให้แล้ว กดลิงก์ในอีเมลก่อนเข้าสู่ระบบ' })
    }
  }

  return (
    <main className={styles.wrap}>
      <div className={styles.card}>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.sub}>{subtitle}</p>

        <label className={styles.label} htmlFor="email">อีเมล</label>
        <input
          id="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          className={styles.input}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <label className={styles.label} htmlFor="password">รหัสผ่าน</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          className={styles.input}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {msg && (
          <p role="status" className={`${styles.msg} ${styles[msg.type]}`}>
            {msg.text}
          </p>
        )}

        <button className={styles.primary} onClick={signIn} disabled={busy || !email || !password}>
          เข้าสู่ระบบ
        </button>
        <button className={styles.secondary} onClick={signUp} disabled={busy || !email || password.length < 6}>
          สมัครสมาชิกใหม่
        </button>
      </div>
    </main>
  )
}
