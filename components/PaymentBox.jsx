'use client'

import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'

// ร้านกดยืนยันว่าลูกค้าจ่ายเงินแล้ว (เงินสดหรือโอนที่หน้าร้านก็ได้)
// รับ props เหมือนเวอร์ชันเดิม (order, onChanged) จึงไม่ต้องแก้ app/shop/page.js

export default function ShopPayment({ order, onChanged }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const paid = order.payment_status === 'paid'

  async function setPaid(next) {
    setBusy(true)
    setError(null)
    const { error: err } = await supabase
      .from('orders')
      .update({ payment_status: next ? 'paid' : 'unpaid' })
      .eq('id', order.id)
    setBusy(false)
    if (err) {
      setError('บันทึกการชำระเงินไม่สำเร็จ: ' + err.message)
      return
    }
    if (onChanged) onChanged()
  }

  return (
    <div style={{ margin: '8px 0' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          borderRadius: 10,
          background: paid ? 'var(--free-soft)' : 'var(--pick-soft)',
          border: `1.5px solid ${paid ? 'var(--free)' : 'var(--pick)'}`,
        }}
      >
        <span
          style={{
            fontSize: '0.9rem',
            fontWeight: 600,
            color: paid ? 'var(--free)' : 'var(--pick)',
          }}
        >
          {paid ? '✅ ชำระเงินแล้ว' : '💵 ยังไม่ชำระเงิน'}
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={() => setPaid(!paid)}
          style={{
            padding: '8px 12px',
            borderRadius: 10,
            fontWeight: 600,
            fontSize: '0.85rem',
            cursor: busy ? 'wait' : 'pointer',
            opacity: busy ? 0.6 : 1,
            border: paid ? '1.5px solid var(--line)' : '0',
            background: paid ? 'transparent' : 'var(--free)',
            color: paid ? 'inherit' : '#fff',
          }}
        >
          {paid ? 'ยกเลิกการยืนยัน' : 'ยืนยันว่าจ่ายแล้ว'}
        </button>
      </div>
      {error && (
        <p role="status" style={{ margin: '6px 0 0', color: 'var(--taken)', fontSize: '0.85rem' }}>
          {error}
        </p>
      )}
    </div>
  )
}
