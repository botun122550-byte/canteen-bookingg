'use client'

// components/ReviewBox.jsx  (ฝั่งลูกค้า: ให้ดาว 1-5 + ความเห็น หลังออเดอร์เสร็จ)
import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import styles from '../app/order/order.module.css'

export default function ReviewBox({ orderId, review, onSaved }) {
  const [editing, setEditing] = useState(false)
  const [rating, setRating] = useState(review?.rating || 0)
  const [comment, setComment] = useState(review?.comment || '')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  async function save() {
    if (rating < 1) return setMsg('เลือกจำนวนดาวก่อน')
    setBusy(true)
    setMsg(null)
    const { error } = await supabase.rpc('submit_review', {
      p_order_id: orderId,
      p_rating: rating,
      p_comment: comment,
    })
    setBusy(false)
    if (error) return setMsg('บันทึกรีวิวไม่สำเร็จ: ' + error.message)
    setEditing(false)
    onSaved?.()
  }

  if (review && !editing) {
    return (
      <div>
        <span aria-label={`ให้ ${review.rating} ดาว`}>{'⭐'.repeat(review.rating)}</span>
        {review.comment && <p className={styles.note}>{review.comment}</p>}
        <button className={styles.ghost} onClick={() => setEditing(true)}>
          แก้รีวิว
        </button>
      </div>
    )
  }

  if (!review && !editing) {
    return (
      <button className={styles.ghost} onClick={() => setEditing(true)}>
        ให้คะแนนร้านนี้
      </button>
    )
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div role="group" aria-label="ให้คะแนน">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            className={styles.ghost}
            aria-pressed={rating === n}
            aria-label={`${n} ดาว`}
            onClick={() => setRating(n)}
            style={{ opacity: rating >= n ? 1 : 0.4 }}
          >
            ⭐
          </button>
        ))}
      </div>
      <input
        className={styles.input}
        aria-label="ความเห็น (ไม่บังคับ)"
        placeholder="ความเห็น (ไม่บังคับ)"
        maxLength={300}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />
      {msg && <p role="alert" className={`${styles.notice} ${styles.error}`}>{msg}</p>}
      <div>
        <button className={styles.primary} onClick={save} disabled={busy}>
          {busy ? 'กำลังบันทึก...' : 'ส่งรีวิว'}
        </button>{' '}
        <button className={styles.ghost} onClick={() => setEditing(false)}>
          ยกเลิก
        </button>
      </div>
    </div>
  )
}
