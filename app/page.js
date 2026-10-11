import Link from 'next/link'
import styles from './order/order.module.css'

export const metadata = {
  title: 'โรงอาหาร: จองโต๊ะและสั่งอาหาร',
}

export default function Home() {
  return (
    <div className={styles.shell}>
      <main className={styles.page}>
        <header className={styles.top}>
          <div>
            <h1 className={styles.title}>โรงอาหาร</h1>
            <p className={styles.sub}>จองโต๊ะ สั่งอาหาร และรับออเดอร์ในที่เดียว</p>
          </div>
        </header>

        <section className={styles.group} aria-labelledby="g-student">
          <h2 id="g-student" className={styles.groupTitle}>สำหรับนักศึกษา</h2>
          <p className={styles.groupSub}>ล็อกอินด้วยอีเมลแล้วใช้งานได้เลย</p>
          <div className={styles.entries}>
            <Link href="/book" className={styles.entry}>
              <span className={styles.entryTitle}>จองโต๊ะ</span>
              <span className={styles.entryText}>เลือกวัน เวลา แล้วแตะโต๊ะที่ว่าง</span>
            </Link>
            <Link href="/order" className={styles.entry}>
              <span className={styles.entryTitle}>สั่งอาหาร</span>
              <span className={styles.entryText}>เลือกร้านและเมนู เลือกตัวเลือกเสริม ให้ส่งถึงโต๊ะที่จองได้</span>
            </Link>
          </div>
        </section>

        <section className={styles.group} aria-labelledby="g-vendor">
          <h2 id="g-vendor" className={styles.groupTitle}>สำหรับพ่อค้าแม่ค้า</h2>
          <p className={styles.groupSub}>ใช้รหัสร้านจากผู้ดูแลระบบเพื่อผูกบัญชีครั้งแรก</p>
          <div className={styles.entries}>
            <Link href="/shop" className={`${styles.entry} ${styles.entryVendor}`}>
              <span className={styles.entryTitle}>หน้าร้านค้า</span>
              <span className={styles.entryText}>รับออเดอร์ เปิดหรือปิดร้าน จัดการเมนูและตัวเลือกเสริม</span>
            </Link>
          </div>
        </section>
      </main>
    </div>
  )
}
