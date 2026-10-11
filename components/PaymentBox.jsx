'use client'

// components/PaymentBox.jsx  (ฝั่งลูกค้า: แสดงสถานะการชำระเงินอย่างเดียว ไม่มี QR ไม่มีแนบสลิป)
// ลูกค้าจ่ายที่ร้านตอนรับอาหาร แล้วร้านกด "รับเงินแล้ว" ในหน้าร้านค้า
import styles from '../app/order/order.module.css'

export default function PaymentBox({ order }) {
  if (order.payment_status === 'paid') {
    return <p className={`${styles.notice} ${styles.ok}`}>✅ ชำระเงินแล้ว</p>
  }
  return <p className={styles.note}>💵 ยังไม่ชำระเงิน จ่ายที่ร้านตอนรับอาหาร</p>
}
