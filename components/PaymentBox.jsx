'use client'

// components/PaymentBox.jsx  (ฝั่งลูกค้า: แสดง QR PromptPay + แนบสลิป)
import { useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { supabase } from '../lib/supabaseClient'
import { promptPayPayload } from '../lib/promptpay'
import styles from '../app/order/order.module.css'

const MAX_BYTES = 5 * 1024 * 1024

export default function PaymentBox({ order, userId, onChanged }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  const status = order.payment_status || 'unpaid'
  if (status === 'paid') return <p className={styles.price}>✅ ชำระเงินแล้ว</p>
  if (status === 'slip_sent') return <p className={styles.price}>⏳ แนบสลิปแล้ว รอร้านตรวจสอบ</p>

  const pid = order.shops?.promptpay_id
  let payload = null
  if (pid) {
    try {
      payload = promptPayPayload(pid, order.total_price)
    } catch {
      payload = null
    }
  }

  async function upload(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) return setMsg('เลือกไฟล์รูปภาพเท่านั้น')
    if (file.size > MAX_BYTES) return setMsg('รูปใหญ่เกิน 5 MB')
    setBusy(true)
    setMsg(null)
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'jpg'
    const path = `${userId}/${order.id}-${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage.from('slips').upload(path, file, { contentType: file.type })
    if (upErr) {
      setBusy(false)
      return setMsg('อัปโหลดสลิปไม่สำเร็จ: ' + upErr.message)
    }
    const { error } = await supabase.rpc('attach_slip', { p_order_id: order.id, p_path: path })
    setBusy(false)
    if (error) return setMsg('บันทึกสลิปไม่สำเร็จ: ' + error.message)
    setOpen(false)
    onChanged?.()
  }

  return (
    <div>
      {!open ? (
        <button className={styles.primary} onClick={() => setOpen(true)}>
          ชำระเงิน
        </button>
      ) : (
        <div style={{ display: 'grid', gap: 8, justifyItems: 'start' }}>
          {payload ? (
            <>
              <div style={{ background: '#fff', padding: 12, borderRadius: 8 }}>
                <QRCodeSVG value={payload} size={200} />
              </div>
              <p className={styles.price}>สแกนจ่ายผ่านแอปธนาคาร ยอด ฿{Number(order.total_price).toLocaleString('th-TH')} แล้วแนบสลิปด้านล่าง</p>
              <label className={styles.label} htmlFor={`slip-${order.id}`}>แนบสลิป (รูปภาพ ไม่เกิน 5 MB)</label>
              <input id={`slip-${order.id}`} type="file" accept="image/*" disabled={busy} onChange={upload} />
            </>
          ) : (
            <p className={styles.hint}>ร้านนี้ยังไม่ได้ตั้งค่า PromptPay จ่ายที่ร้านได้เลย</p>
          )}
          {busy && <p className={styles.hint}>กำลังอัปโหลด...</p>}
          {msg && <p role="alert" className={`${styles.notice} ${styles.error}`}>{msg}</p>}
          <button className={styles.ghost} onClick={() => setOpen(false)}>
            ปิด
          </button>
        </div>
      )}
    </div>
  )
}
