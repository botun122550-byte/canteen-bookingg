import Link from 'next/link'
import styles from './home.module.css'

export const metadata = {
  title: 'โรงอาหาร: จองโต๊ะและสั่งอาหาร',
  description: 'จองโต๊ะ สั่งอาหาร และรับออเดอร์ในที่เดียว',
}

const STUDENT = [
  {
    href: '/book',
    icon: '🪑',
    tone: 'toneOrange',
    title: 'จองโต๊ะ',
    text: 'เลือกวัน เวลา แล้วแตะโต๊ะที่ว่าง',
  },
  {
    href: '/order',
    icon: '🍜',
    tone: 'toneYellow',
    title: 'สั่งอาหาร',
    text: 'เลือกร้านและเมนู เลือกตัวเลือกเสริม ให้ส่งถึงโต๊ะที่จองได้',
  },
]

const MERCHANT = [
  {
    href: '/shop',
    icon: '🏪',
    tone: 'toneMint',
    title: 'หน้าร้านค้า',
    text: 'รับออเดอร์ เปิดหรือปิดร้าน จัดการเมนูและตัวเลือกเสริม',
  },
]

const STEPS = [
  { icon: '🪑', label: 'จองโต๊ะ' },
  { icon: '🍜', label: 'สั่งอาหาร' },
  { icon: '🔔', label: 'รอแจ้งเตือน' },
]

function Card({ href, icon, tone, title, text }) {
  return (
    <Link href={href} className={`${styles.card} ${styles[tone]}`}>
      <span className={styles.icon} aria-hidden="true">{icon}</span>
      <span className={styles.cardBody}>
        <span className={styles.cardTitle}>{title}</span>
        <span className={styles.cardText}>{text}</span>
      </span>
      <span className={styles.arrow} aria-hidden="true">›</span>
    </Link>
  )
}

export default function HomePage() {
  return (
    <div className={styles.shell}>
      <main className={styles.page}>
        <header className={styles.hero}>
          <span className={`${styles.float} ${styles.f1}`} aria-hidden="true">🍜</span>
          <span className={`${styles.float} ${styles.f2}`} aria-hidden="true">🥤</span>
          <span className={`${styles.float} ${styles.f3}`} aria-hidden="true">🍛</span>
          <p className={styles.eyebrow}>ยินดีต้อนรับ 👋</p>
          <h1 className={styles.title}>โรงอาหาร</h1>
          <p className={styles.sub}>จองโต๊ะ สั่งอาหาร และรับออเดอร์ในที่เดียว</p>
        </header>

        <section aria-labelledby="h-steps">
          <h2 id="h-steps" className={styles.srOnly}>ใช้งานง่ายแค่ 3 ขั้นตอน</h2>
          <ol className={styles.steps}>
            {STEPS.map((s, i) => (
              <li key={s.label} className={styles.step}>
                <span className={styles.stepNum}>{i + 1}</span>
                <span className={styles.stepIcon} aria-hidden="true">{s.icon}</span>
                <span className={styles.stepLabel}>{s.label}</span>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="h-student">
          <h2 id="h-student" className={styles.h2}>สำหรับนักศึกษา</h2>
          <p className={styles.hint}>ล็อกอินด้วยอีเมลแล้วใช้งานได้เลย</p>
          <div className={styles.cards}>
            {STUDENT.map((c) => (
              <Card key={c.href} {...c} />
            ))}
          </div>
        </section>

        <section aria-labelledby="h-merchant">
          <h2 id="h-merchant" className={styles.h2}>สำหรับพ่อค้าแม่ค้า</h2>
          <p className={styles.hint}>ใช้รหัสร้านจากผู้ดูแลระบบเพื่อผูกบัญชีครั้งแรก</p>
          <div className={styles.cards}>
            {MERCHANT.map((c) => (
              <Card key={c.href} {...c} />
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}
