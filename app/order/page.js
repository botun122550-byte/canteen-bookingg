'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../lib/supabaseClient'
import AuthBox from '../../components/AuthBox'
import styles from './order.module.css'

const STATUS = {
  new: { text: 'รอร้านรับออเดอร์', cls: 'sNew' },
  cooking: { text: 'กำลังทำ', cls: 'sCooking' },
  ready: { text: 'พร้อมรับแล้ว', cls: 'sReady' },
  done: { text: 'เสร็จสิ้น', cls: 'sDone' },
  cancelled: { text: 'ยกเลิกแล้ว', cls: 'sCancel' },
}

const pad = (n) => String(n).padStart(2, '0')
const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`
const baht = (n) => `฿${Number(n).toLocaleString('th-TH')}`

function orderError(msg = '') {
  if (msg.includes('shop_closed')) return 'ร้านนี้ปิดรับออเดอร์อยู่ตอนนี้'
  if (msg.includes('item_unavailable')) return 'มีเมนูที่หมดหรือถูกเอาออกแล้ว กรุณาเลือกใหม่'
  if (msg.includes('empty_order')) return 'ยังไม่ได้เลือกเมนู'
  return 'สั่งอาหารไม่สำเร็จ: ' + msg
}

export default function OrderPage() {
  const [mounted, setMounted] = useState(false)
  const [authReady, setAuthReady] = useState(false)
  const [user, setUser] = useState(null)
  const [shops, setShops] = useState([])
  const [shopId, setShopId] = useState(null)
  const [menu, setMenu] = useState([])
  const [cart, setCart] = useState({})
  const [bookings, setBookings] = useState([])
  const [deliverTo, setDeliverTo] = useState('pickup')
  const [note, setNote] = useState('')
  const [myOrders, setMyOrders] = useState([])
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState(null)

  useEffect(() => {
    setMounted(true)
  }, [])

  // สถานะล็อกอิน
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null)
      setAuthReady(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  // รายชื่อร้าน
  useEffect(() => {
    if (!user) return
    supabase
      .from('shops')
      .select('id, name, is_open')
      .order('name')
      .then(({ data, error }) => {
        if (error) {
          setNotice({ type: 'error', text: 'โหลดรายชื่อร้านไม่สำเร็จ: ' + error.message })
          return
        }
        const list = data || []
        setShops(list)
        setShopId((cur) => cur ?? (list.find((s) => s.is_open) || list[0])?.id ?? null)
      })
  }, [user])

  // เมนูของร้านที่เลือก
  const loadMenu = useCallback(async () => {
    if (!shopId) {
      setMenu([])
      return
    }
    const { data, error } = await supabase
      .from('menu_items')
      .select('id, name, price, is_available')
      .eq('shop_id', shopId)
      .order('name')
    if (error) {
      setNotice({ type: 'error', text: 'โหลดเมนูไม่สำเร็จ: ' + error.message })
      return
    }
    setMenu(data || [])
  }, [shopId])

  useEffect(() => {
    loadMenu()
  }, [loadMenu])

  // โต๊ะที่จองไว้ (ใช้เลือกให้ร้านส่งอาหารที่โต๊ะ)
  useEffect(() => {
    if (!user) return
    supabase
      .from('reservations')
      .select('id, table_id, start_time, end_time, tables(name)')
      .eq('user_id', user.id)
      .eq('status', 'booked')
      .gt('end_time', new Date().toISOString())
      .order('start_time')
      .then(({ data }) => setBookings(data || []))
  }, [user])

  // ออเดอร์ของฉัน (24 ชั่วโมงล่าสุด)
  const loadOrders = useCallback(async () => {
    if (!user) return
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
    const { data, error } = await supabase
      .from('orders')
      .select('id, status, total_price, created_at, note, shops(name), tables(name), order_items(name, quantity)')
      .eq('user_id', user.id)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
    if (error) {
      setNotice({ type: 'error', text: 'โหลดออเดอร์ไม่สำเร็จ: ' + error.message })
      return
    }
    setMyOrders(data || [])
  }, [user])

  useEffect(() => {
    loadOrders()
  }, [loadOrders])

  // อัปเดตสถานะออเดอร์และเมนูแบบเรียลไทม์
  useEffect(() => {
    if (!user) return
    const channel = supabase
      .channel('order-page-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => loadOrders())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'menu_items' }, () => loadMenu())
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [user, loadOrders, loadMenu])

  const shop = shops.find((s) => s.id === shopId) || null
  const shopOpen = Boolean(shop?.is_open)

  function pickShop(id) {
    setShopId(id)
    setCart({})
    setNotice(null)
  }

  function setQty(id, delta) {
    setCart((cur) => {
      const next = Math.min(20, Math.max(0, (cur[id] || 0) + delta))
      const copy = { ...cur }
      if (next === 0) delete copy[id]
      else copy[id] = next
      return copy
    })
  }

  const lines = menu.filter((m) => cart[m.id] > 0)
  const totalQty = lines.reduce((sum, m) => sum + cart[m.id], 0)
  const totalPrice = lines.reduce((sum, m) => sum + cart[m.id] * Number(m.price), 0)

  async function placeOrder() {
    if (!lines.length || !shopOpen) return
    setSaving(true)
    setNotice(null)
    const { error } = await supabase.rpc('place_order', {
      p_shop_id: shopId,
      p_table_id: deliverTo === 'pickup' ? null : deliverTo,
      p_note: note,
      p_items: lines.map((m) => ({ menu_item_id: m.id, quantity: cart[m.id] })),
    })
    setSaving(false)
    if (error) {
      setNotice({ type: 'error', text: orderError(error.message) })
      loadMenu()
      return
    }
    setNotice({ type: 'ok', text: 'ส่งออเดอร์แล้ว รอร้านรับออเดอร์ ดูสถานะได้ที่ด้านล่าง' })
    setCart({})
    setNote('')
    loadOrders()
  }

  async function cancelOrder(id) {
    setNotice(null)
    const { error } = await supabase
      .from('orders')
      .update({ status: 'cancelled' })
      .eq('id', id)
      .eq('status', 'new')
    if (error) {
      setNotice({ type: 'error', text: 'ยกเลิกไม่สำเร็จ: ' + error.message })
      return
    }
    loadOrders()
  }

  if (!mounted || !authReady) {
    return (
      <div className={styles.shell}>
        <p className={styles.loading}>กำลังโหลด...</p>
      </div>
    )
  }

  if (!user) {
    return (
      <div className={styles.shell}>
        <AuthBox />
      </div>
    )
  }

  return (
    <div className={styles.shell}>
      <main className={styles.page}>
        <header className={styles.top}>
          <div>
            <h1 className={styles.title}>สั่งอาหาร</h1>
            <p className={styles.sub}>เลือกร้าน เลือกเมนู แล้วสั่งได้เลย</p>
          </div>
          <div className={styles.nav}>
            <Link href="/book" className={styles.ghost}>
              จองโต๊ะ
            </Link>
            <button className={styles.ghost} onClick={() => supabase.auth.signOut()}>
              ออกจากระบบ
            </button>
          </div>
        </header>

        {notice && (
          <p role="status" className={`${styles.notice} ${styles[notice.type]}`}>
            {notice.text}
          </p>
        )}

        <section aria-labelledby="h-shop">
          <h2 id="h-shop" className={styles.h2}>เลือกร้าน</h2>
          {shops.length === 0 && <p className={styles.hint}>ยังไม่มีร้านในระบบ</p>}
          <div className={styles.chips} role="group" aria-label="เลือกร้าน">
            {shops.map((s) => (
              <button
                key={s.id}
                className={`${styles.chip} ${shopId === s.id ? styles.on : ''}`}
                aria-pressed={shopId === s.id}
                onClick={() => pickShop(s.id)}
              >
                {s.name}
                {!s.is_open && ' (ปิด)'}
              </button>
            ))}
          </div>
        </section>

        {shop && (
          <section aria-labelledby="h-menu">
            <h2 id="h-menu" className={styles.h2}>เมนู {shop.name}</h2>
            {!shopOpen && <p className={styles.hint}>ร้านนี้ปิดรับออเดอร์อยู่ตอนนี้ ลองเลือกร้านอื่นดู</p>}
            {menu.length === 0 && <p className={styles.hint}>ร้านนี้ยังไม่มีเมนู</p>}
            <ul className={styles.list}>
              {menu.map((m) => {
                const qty = cart[m.id] || 0
                const canAdd = m.is_available && shopOpen
                return (
                  <li key={m.id} className={`${styles.item} ${!m.is_available ? styles.soldOut : ''}`}>
                    <div>
                      <div className={styles.itemName}>{m.name}</div>
                      <div className={styles.price}>{m.is_available ? baht(m.price) : 'หมด'}</div>
                    </div>
                    <div className={styles.stepper}>
                      <button aria-label={`ลด ${m.name}`} onClick={() => setQty(m.id, -1)} disabled={!qty}>
                        −
                      </button>
                      <span aria-live="polite">{qty}</span>
                      <button aria-label={`เพิ่ม ${m.name}`} onClick={() => setQty(m.id, 1)} disabled={!canAdd}>
                        +
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        {lines.length > 0 && (
          <section aria-labelledby="h-deliver">
            <h2 id="h-deliver" className={styles.h2}>รับอาหารที่ไหน</h2>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="deliver">สถานที่รับอาหาร</label>
              <select
                id="deliver"
                className={styles.select}
                value={deliverTo}
                onChange={(e) => setDeliverTo(e.target.value)}
              >
                <option value="pickup">มารับที่ร้านเอง</option>
                {bookings.map((b) => (
                  <option key={b.id} value={b.table_id}>
                    ส่งที่โต๊ะ {b.tables?.name} (จอง {hhmm(new Date(b.start_time))}–{hhmm(new Date(b.end_time))})
                  </option>
                ))}
              </select>
              {bookings.length === 0 && (
                <span className={styles.price}>จองโต๊ะไว้ก่อน แล้วจะเลือกให้ร้านส่งอาหารที่โต๊ะได้</span>
              )}
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="note">หมายเหตุถึงร้าน (ไม่บังคับ)</label>
              <input
                id="note"
                className={styles.input}
                value={note}
                maxLength={120}
                placeholder="เช่น ไม่ใส่ผัก เผ็ดน้อย"
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </section>
        )}

        <section aria-labelledby="h-orders">
          <h2 id="h-orders" className={styles.h2}>ออเดอร์ของฉัน</h2>
          {myOrders.length === 0 && <p className={styles.hint}>ยังไม่มีออเดอร์ใน 24 ชั่วโมงที่ผ่านมา</p>}
          <ul className={styles.orders}>
            {myOrders.map((o) => {
              const st = STATUS[o.status] || STATUS.new
              return (
                <li key={o.id} className={styles.order}>
                  <div className={styles.orderHead}>
                    <strong>{o.shops?.name}</strong>
                    <span className={`${styles.pill} ${styles[st.cls]}`}>{st.text}</span>
                  </div>
                  <div className={styles.orderMeta}>
                    {hhmm(new Date(o.created_at))} น. {o.tables?.name ? `ส่งที่โต๊ะ ${o.tables.name}` : 'มารับที่ร้าน'}
                  </div>
                  <ul className={styles.lines}>
                    {o.order_items.map((it, i) => (
                      <li key={i}>
                        {it.name} × {it.quantity}
                      </li>
                    ))}
                  </ul>
                  {o.note && <p className={styles.note}>หมายเหตุ: {o.note}</p>}
                  <div className={styles.orderFoot}>
                    <strong>{baht(o.total_price)}</strong>
                    {o.status === 'new' && (
                      <button className={styles.danger} onClick={() => cancelOrder(o.id)}>
                        ยกเลิกออเดอร์
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      </main>

      {totalQty > 0 && (
        <div className={styles.bar}>
          <div className={styles.barInner}>
            <div>
              <strong>{baht(totalPrice)}</strong>
              <div className={styles.barSub}>{totalQty} รายการ จาก {shop?.name}</div>
            </div>
            <button className={styles.confirm} onClick={placeOrder} disabled={saving || !shopOpen}>
              {saving ? 'กำลังส่ง...' : 'สั่งอาหาร'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
