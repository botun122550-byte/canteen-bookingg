'use client'

// app/order/page.js
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../lib/supabaseClient'
import AuthBox from '../../components/AuthBox'
import TelegramLink from '../../components/TelegramLink'
import PaymentBox from '../../components/PaymentBox'
import ReviewBox from '../../components/ReviewBox'
import styles from './order.module.css'

const STATUS = {
  new: { text: 'รอร้านรับออเดอร์', cls: 'sNew' },
  cooking: { text: 'กำลังทำ', cls: 'sCooking' },
  ready: { text: 'พร้อมรับแล้ว', cls: 'sReady' },
  done: { text: 'เสร็จสิ้น', cls: 'sDone' },
  cancelled: { text: 'ยกเลิกแล้ว', cls: 'sCancel' },
}

const MAX_QTY = 20

const pad = (n) => String(n).padStart(2, '0')
const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`
const baht = (n) => `฿${Number(n).toLocaleString('th-TH')}`

const badge = (bg) => ({
  display: 'inline-block',
  marginLeft: 6,
  padding: '1px 8px',
  borderRadius: 999,
  fontSize: 12,
  background: bg,
  color: '#fff',
})

function orderError(msg = '') {
  if (msg.includes('shop_closed')) return 'ร้านนี้ปิดรับออเดอร์อยู่ตอนนี้'
  if (msg.includes('item_unavailable')) return 'มีเมนูหรือตัวเลือกที่หมดแล้ว กรุณาตรวจสอบตะกร้าอีกครั้ง'
  if (msg.includes('empty_order')) return 'ยังไม่ได้เลือกเมนู'
  return 'สั่งอาหารไม่สำเร็จ: ' + msg
}

// เรียงตัวเลือก: ฟรีก่อน แล้วเรียงตามราคา และชื่อ
function sortedOptions(item) {
  return [...(item.menu_options || [])].sort(
    (a, b) => Number(a.extra_price) - Number(b.extra_price) || a.name.localeCompare(b.name, 'th')
  )
}

export default function OrderPage() {
  const [mounted, setMounted] = useState(false)
  const [authReady, setAuthReady] = useState(false)
  const [user, setUser] = useState(null)
  const [shops, setShops] = useState([])
  const [shopId, setShopId] = useState(null)
  const [menu, setMenu] = useState([])
  const [best, setBest] = useState([])
  const [waiting, setWaiting] = useState({})
  const [ratings, setRatings] = useState({})
  const [myReviews, setMyReviews] = useState({})
  const [cart, setCart] = useState([])
  const [bookings, setBookings] = useState([])
  const [deliverTo, setDeliverTo] = useState('pickup')
  const [note, setNote] = useState('')
  const [myOrders, setMyOrders] = useState([])
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState(null)

  // หน้าต่างเลือกตัวเลือกเสริม
  const dialogRef = useRef(null)
  const [editing, setEditing] = useState(null)
  const [draftOpts, setDraftOpts] = useState([])
  const [draftQty, setDraftQty] = useState(1)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    const d = dialogRef.current
    if (!d) return
    if (editing && !d.open) d.showModal()
    if (!editing && d.open) d.close()
  }, [editing])

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

  // รายชื่อร้าน + คะแนนเฉลี่ย
  useEffect(() => {
    if (!user) return
    supabase
      .from('shops')
      .select('id, name, is_open, minutes_per_order')
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
    supabase.rpc('shop_ratings').then(({ data }) => {
      setRatings(Object.fromEntries((data || []).map((r) => [r.shop_id, r])))
    })
  }, [user])

  // จำนวนออเดอร์ที่ค้างอยู่ในแต่ละร้าน (ใช้ประมาณเวลารอ)
  const loadWaiting = useCallback(async () => {
    const { data } = await supabase.rpc('shop_queue_counts')
    setWaiting(Object.fromEntries((data || []).map((r) => [r.shop_id, Number(r.waiting)])))
  }, [])

  useEffect(() => {
    if (!user) return
    loadWaiting()
    const t = setInterval(loadWaiting, 30000)
    return () => clearInterval(t)
  }, [user, loadWaiting])

  // เมนูของร้านที่เลือก (พร้อมตัวเลือกเสริม) + เมนูขายดี
  const loadMenu = useCallback(async () => {
    if (!shopId) {
      setMenu([])
      setBest([])
      return
    }
    const { data, error } = await supabase
      .from('menu_items')
      .select('id, name, price, is_available, is_recommended, menu_options(id, name, extra_price, is_available)')
      .eq('shop_id', shopId)
      .order('name')
    if (error) {
      setNotice({ type: 'error', text: 'โหลดเมนูไม่สำเร็จ: ' + error.message })
      return
    }
    setMenu(data || [])
    const { data: b } = await supabase.rpc('best_sellers', { p_shop_id: shopId })
    setBest((b || []).filter((r) => Number(r.qty) >= 3).map((r) => r.name))
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

  // ออเดอร์ของฉัน (24 ชั่วโมงล่าสุด) + รีวิวที่เคยให้
  const loadOrders = useCallback(async () => {
    if (!user) return
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
    const { data, error } = await supabase
      .from('orders')
      .select(
        'id, status, total_price, created_at, note, queue_no, reject_reason, payment_status, slip_path, shops(name, promptpay_id), tables(name), order_items(name, quantity, options)'
      )
      .eq('user_id', user.id)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
    if (error) {
      setNotice({ type: 'error', text: 'โหลดออเดอร์ไม่สำเร็จ: ' + error.message })
      return
    }
    setMyOrders(data || [])
    const { data: rv } = await supabase
      .from('reviews')
      .select('order_id, rating, comment')
      .eq('user_id', user.id)
    setMyReviews(Object.fromEntries((rv || []).map((r) => [r.order_id, r])))
  }, [user])

  useEffect(() => {
    loadOrders()
  }, [loadOrders])

  // อัปเดตสถานะออเดอร์ เมนู และตัวเลือกแบบเรียลไทม์
  useEffect(() => {
    if (!user) return
    const channel = supabase
      .channel('order-page-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
        loadOrders()
        loadWaiting()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'menu_items' }, () => loadMenu())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'menu_options' }, () => loadMenu())
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [user, loadOrders, loadMenu, loadWaiting])

  const shop = shops.find((s) => s.id === shopId) || null
  const shopOpen = Boolean(shop?.is_open)
  const waitingNow = shop ? waiting[shop.id] ?? 0 : 0
  const etaMinutes = shop ? (waitingNow + 1) * (shop.minutes_per_order || 5) : 0

  // ขายดีก่อน แล้วเมนูแนะนำ แล้วเรียงตามชื่อ เมนูที่หมดไว้ท้ายสุด
  const rank = (m) => (best.indexOf(m.name) >= 0 ? best.indexOf(m.name) : 99)
  const sortedMenu = [...menu].sort(
    (a, b) =>
      Number(b.is_available) - Number(a.is_available) ||
      rank(a) - rank(b) ||
      Number(b.is_recommended) - Number(a.is_recommended) ||
      a.name.localeCompare(b.name, 'th')
  )

  function pickShop(id) {
    setShopId(id)
    setCart([])
    setNotice(null)
  }

  // ===== ตะกร้า =====
  function addToCart(item, optionIds, qty) {
    const ids = [...optionIds].sort()
    const key = `${item.id}|${ids.join(',')}`
    setCart((cur) => {
      const found = cur.find((l) => l.key === key)
      if (found) {
        return cur.map((l) => (l.key === key ? { ...l, qty: Math.min(MAX_QTY, l.qty + qty) } : l))
      }
      return [...cur, { key, itemId: item.id, optionIds: ids, qty: Math.min(MAX_QTY, qty) }]
    })
    setNotice(null)
  }

  function changeLine(key, delta) {
    setCart((cur) =>
      cur
        .map((l) => (l.key === key ? { ...l, qty: Math.min(MAX_QTY, l.qty + delta) } : l))
        .filter((l) => l.qty > 0)
    )
  }

  function openItem(item) {
    const hasOptions = (item.menu_options || []).length > 0
    if (!hasOptions) {
      addToCart(item, [], 1)
      return
    }
    setDraftOpts([])
    setDraftQty(1)
    setEditing(item)
  }

  function toggleDraft(id) {
    setDraftOpts((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
  }

  function confirmDraft() {
    if (!editing) return
    addToCart(editing, draftOpts, draftQty)
    setEditing(null)
  }

  // รวมรายละเอียดของแต่ละบรรทัดในตะกร้า
  const cartLines = cart
    .map((l) => {
      const item = menu.find((m) => m.id === l.itemId)
      if (!item) return null
      const opts = (item.menu_options || []).filter((o) => l.optionIds.includes(o.id))
      const unit = Number(item.price) + opts.reduce((sum, o) => sum + Number(o.extra_price), 0)
      const available =
        item.is_available && opts.length === l.optionIds.length && opts.every((o) => o.is_available)
      return { ...l, item, opts, unit, total: unit * l.qty, available }
    })
    .filter(Boolean)

  const totalQty = cartLines.reduce((sum, l) => sum + l.qty, 0)
  const totalPrice = cartLines.reduce((sum, l) => sum + l.total, 0)
  const hasUnavailable = cartLines.some((l) => !l.available)

  const draftUnit = editing
    ? Number(editing.price) +
      (editing.menu_options || [])
        .filter((o) => draftOpts.includes(o.id))
        .reduce((sum, o) => sum + Number(o.extra_price), 0)
    : 0

  async function placeOrder() {
    if (!cartLines.length || !shopOpen || hasUnavailable) return
    setSaving(true)
    setNotice(null)
    const { error } = await supabase.rpc('place_order', {
      p_shop_id: shopId,
      p_table_id: deliverTo === 'pickup' ? null : deliverTo,
      p_note: note,
      p_items: cartLines.map((l) => ({
        menu_item_id: l.itemId,
        quantity: l.qty,
        option_ids: l.optionIds,
      })),
    })
    setSaving(false)
    if (error) {
      setNotice({ type: 'error', text: orderError(error.message) })
      loadMenu()
      return
    }
    setNotice({ type: 'ok', text: 'ส่งออเดอร์แล้ว รอร้านรับออเดอร์ ดูสถานะและชำระเงินได้ที่ด้านล่าง' })
    setCart([])
    setNote('')
    loadOrders()
    loadWaiting()
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
        <AuthBox title="สั่งอาหาร" subtitle="เข้าสู่ระบบด้วยอีเมลเพื่อสั่งอาหาร" />
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

        <TelegramLink userId={user.id} audience="student" />

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
                {ratings[s.id] && ` ★${ratings[s.id].avg_rating}`}
                {!s.is_open && ' (ปิด)'}
              </button>
            ))}
          </div>
        </section>

        {shop && (
          <section aria-labelledby="h-menu">
            <h2 id="h-menu" className={styles.h2}>เมนู {shop.name}</h2>
            {shopOpen && (
              <p className={styles.hint}>
                ⏱ ประมาณ {etaMinutes} นาที (มีคิวรออยู่ {waitingNow} ออเดอร์)
                {ratings[shop.id] && ` · ★${ratings[shop.id].avg_rating} จาก ${ratings[shop.id].review_count} รีวิว`}
              </p>
            )}
            {!shopOpen && <p className={styles.hint}>ร้านนี้ปิดรับออเดอร์อยู่ตอนนี้ ลองเลือกร้านอื่นดู</p>}
            {menu.length === 0 && <p className={styles.hint}>ร้านนี้ยังไม่มีเมนู</p>}
            <ul className={styles.list}>
              {sortedMenu.map((m) => {
                const optCount = (m.menu_options || []).length
                const canAdd = m.is_available && shopOpen
                return (
                  <li key={m.id} className={`${styles.item} ${!m.is_available ? styles.soldOut : ''}`}>
                    <div>
                      <div className={styles.itemName}>
                        {m.name}
                        {m.is_available && best.includes(m.name) && <span style={badge('#d9480f')}>ขายดี</span>}
                        {m.is_available && m.is_recommended && <span style={badge('#e8590c')}>แนะนำ</span>}
                      </div>
                      <div className={styles.price}>{m.is_available ? baht(m.price) : 'หมด'}</div>
                      {optCount > 0 && m.is_available && (
                        <div className={styles.itemHint}>มีตัวเลือกเสริม</div>
                      )}
                    </div>
                    <button
                      className={styles.addBtn}
                      disabled={!canAdd}
                      onClick={() => openItem(m)}
                      aria-label={`${optCount > 0 ? 'เลือกตัวเลือกและเพิ่ม' : 'เพิ่ม'} ${m.name}`}
                    >
                      {optCount > 0 ? 'เลือก' : 'เพิ่ม'}
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        {cartLines.length > 0 && (
          <section aria-labelledby="h-cart">
            <h2 id="h-cart" className={styles.h2}>ตะกร้า</h2>
            <ul className={styles.list}>
              {cartLines.map((l) => (
                <li key={l.key} className={styles.cartLine}>
                  <div>
                    <div className={styles.itemName}>{l.item.name}</div>
                    {l.opts.length > 0 && (
                      <div className={styles.cartOpts}>{l.opts.map((o) => o.name).join(', ')}</div>
                    )}
                    <div className={styles.price}>{baht(l.total)}</div>
                    {!l.available && <div className={styles.gone}>มีรายการที่หมดแล้ว ลบออกก่อนสั่ง</div>}
                  </div>
                  <div className={styles.stepper}>
                    <button aria-label={`ลด ${l.item.name}`} onClick={() => changeLine(l.key, -1)}>
                      −
                    </button>
                    <span aria-live="polite">{l.qty}</span>
                    <button
                      aria-label={`เพิ่ม ${l.item.name}`}
                      onClick={() => changeLine(l.key, 1)}
                      disabled={l.qty >= MAX_QTY || !l.available}
                    >
                      +
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {cartLines.length > 0 && (
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
                placeholder="เช่น ขอช้อนส้อมเพิ่ม"
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
                    <strong>
                      {o.queue_no ? `คิว ${o.queue_no}` : `#${o.id.slice(0, 4).toUpperCase()}`} · {o.shops?.name}
                    </strong>
                    <span className={`${styles.pill} ${styles[st.cls]}`}>{st.text}</span>
                  </div>
                  <div className={styles.orderMeta}>
                    {hhmm(new Date(o.created_at))} น. {o.tables?.name ? `ส่งที่โต๊ะ ${o.tables.name}` : 'มารับที่ร้าน'}
                  </div>
                  <ul className={styles.lines}>
                    {o.order_items.map((it, i) => (
                      <li key={i}>
                        {it.name}
                        {it.options ? ` (${it.options})` : ''} × {it.quantity}
                      </li>
                    ))}
                  </ul>
                  {o.note && <p className={styles.note}>หมายเหตุ: {o.note}</p>}
                  {o.status === 'cancelled' && o.reject_reason && (
                    <p className={styles.note}>เหตุผลที่ร้านแจ้ง: {o.reject_reason}</p>
                  )}
                  <div className={styles.orderFoot}>
                    <strong>{baht(o.total_price)}</strong>
                    {o.status === 'new' && (
                      <button className={styles.danger} onClick={() => cancelOrder(o.id)}>
                        ยกเลิกออเดอร์
                      </button>
                    )}
                  </div>
                  {o.status !== 'cancelled' && (
                    <PaymentBox order={o} userId={user.id} onChanged={loadOrders} />
                  )}
                  {o.status === 'done' && (
                    <ReviewBox
                      key={`${o.id}-${myReviews[o.id]?.rating ?? 0}`}
                      orderId={o.id}
                      review={myReviews[o.id]}
                      onSaved={loadOrders}
                    />
                  )}
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
            <button
              className={styles.confirm}
              onClick={placeOrder}
              disabled={saving || !shopOpen || hasUnavailable}
            >
              {saving ? 'กำลังส่ง...' : 'สั่งอาหาร'}
            </button>
          </div>
        </div>
      )}

      <dialog
        ref={dialogRef}
        className={styles.dialog}
        aria-labelledby="dlg-title"
        onClose={() => setEditing(null)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setEditing(null)
        }}
      >
        {editing && (
          <div className={styles.sheet}>
            <h2 id="dlg-title" className={styles.sheetTitle}>{editing.name}</h2>
            <p className={styles.price}>ราคาเริ่มต้น {baht(editing.price)}</p>

            <fieldset className={styles.fieldset}>
              <legend className={styles.label}>ตัวเลือกเสริม (เลือกได้หลายอย่าง)</legend>
              {sortedOptions(editing).map((o) => (
                <label key={o.id} className={`${styles.check} ${!o.is_available ? styles.soldOut : ''}`}>
                  <input
                    type="checkbox"
                    checked={draftOpts.includes(o.id)}
                    disabled={!o.is_available}
                    onChange={() => toggleDraft(o.id)}
                  />
                  <span>
                    {o.name}
                    {!o.is_available && ' (หมด)'}
                  </span>
                  <span className={styles.price}>
                    {Number(o.extra_price) > 0 ? `+${baht(o.extra_price)}` : 'ฟรี'}
                  </span>
                </label>
              ))}
            </fieldset>

            <div className={styles.sheetQty}>
              <span className={styles.label}>จำนวน</span>
              <div className={styles.stepper}>
                <button aria-label="ลดจำนวน" onClick={() => setDraftQty((q) => Math.max(1, q - 1))} disabled={draftQty <= 1}>
                  −
                </button>
                <span aria-live="polite">{draftQty}</span>
                <button aria-label="เพิ่มจำนวน" onClick={() => setDraftQty((q) => Math.min(MAX_QTY, q + 1))} disabled={draftQty >= MAX_QTY}>
                  +
                </button>
              </div>
            </div>

            <div className={styles.sheetActions}>
              <button className={styles.ghost} onClick={() => setEditing(null)}>
                ปิด
              </button>
              <button className={styles.confirm} onClick={confirmDraft}>
                เพิ่มลงตะกร้า {baht(draftUnit * draftQty)}
              </button>
            </div>
          </div>
        )}
      </dialog>
    </div>
  )
}
