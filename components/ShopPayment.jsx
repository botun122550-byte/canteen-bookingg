'use client'

// components/ShopPayment.jsx  (ฝั่งร้าน: ดูสลิป ยืนยัน/ปฏิเสธการชำระเงิน)
import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import styles from '../app/order/order.module.css'

export default function ShopPayment({ order, onChanged }) {
  const [slipUrl, setSlipUrl] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const status = order.payment_status || 'unpaid'

  async function viewSlip() {
    setMsg(null)
    const { data, error } = await supabase.storage.from('slips').createSignedUrl(order.slip_path, 300)
    if (error) return setMsg('เปิดสลิปไม่สำเร็จ: ' + error.message)
    setSlipUrl(data.signedUrl)
  }

  async function setPay(next) {
    setBusy(true)
    setMsg(null)
    const { error } = await supabase.rpc('set_payment', { p_order_id: order.id, p_status: next })
    setBusy(false)
    if (error) return setMsg('อัปเดตการชำระเงินไม่สำเร็จ: ' + error.message)
    setSlipUrl(null)
    onChanged?.()
  }

  if (status === 'paid') {
    return <div className={styles.orderMeta}>✅ ชำระเงินแล้ว</div>
  }

  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <div className={styles.orderMeta}>
        {status === 'slip_sent' ? '💸 ลูกค้าแนบสลิปแล้ว รอตรวจสอบ' : 'ยังไม่ชำระเงิน'}
      </div>
      {status === 'slip_sent' && order.slip_path && (
        <>
          {!slipUrl ? (
            <button className={styles.ghost} onClick={viewSlip}>ดูสลิป</button>
          ) : (
            <a href={slipUrl} target="_blank" rel="noopener noreferrer" className={styles.ghost}>
              เปิดรูปสลิป (ลิงก์หมดอายุใน 5 นาที)
            </a>
          )}
        </>
      )}
      <div className={styles.actions}>
        <button className={styles.primary} disabled={busy} onClick={() => setPay('paid')}>
          {status === 'slip_sent' ? 'ยืนยันรับเงินแล้ว' : 'รับเงินสดแล้ว'}
        </button>
        {status === 'slip_sent' && (
          <button className={styles.danger} disabled={busy} onClick={() => setPay('unpaid')}>
            สลิปไม่ถูกต้อง
          </button>
        )}
      </div>
      {msg && <p role="alert" className={`${styles.notice} ${styles.error}`}>{msg}</p>}
    </div>
  )
}
