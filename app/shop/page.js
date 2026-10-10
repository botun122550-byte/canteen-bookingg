'use client'

// app/shop/page.js
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import AuthBox from '../../components/AuthBox'
import TelegramLink from '../../components/TelegramLink'
import ShopPayment from '../../components/ShopPayment'
import styles from '../order/order.module.css'

const COLUMNS = [
  { key: 'new', title: 'ออเดอร์ใหม่', empty: 'ยังไม่มีออเดอร์ใหม่' },
  { key: 'cooking', title: 'กำลังทำ', empty: 'ไม่มีออเดอร์ที่กำลังทำ' },
  { key: 'ready', title: 'พร้อมรับ', empty: 'ไม่มีออเดอร์ที่รอลูกค้ารับ' },
]

const NEXT = {
  new: { to: 'cooking', label: 'เริ่มทำ' },
  cooking: { to: 'ready', label: 'ทำเสร็จแล้ว' },
  ready: { to: 'done', label: 'ลูกค้ารับแล้ว' },
}

const REASONS = ['วัตถุดิบหมด', 'ร้านปิดแล้ว', 'ออเดอร์ไม่ชัดเจน', 'อื่น ๆ']

const pad = (n) => String(n).padStart(2, '0')
const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`
const baht = (n) => `฿${Number(n).toLocaleString('th-TH')}`
const orderRef = (o) => (o.queue_no ? `คิว ${o.queue_no}` : `#${o.id.slice(0, 4).toUpperCase()}`)

function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    const ctx = new Ctx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.2, ctx.currentTime)
    osc.start()
    osc.stop(ctx.currentTime + 0.35)
    setTimeout(() => ctx.close(), 600)
  } catch {
    // เบราว์เซอร์ไม่รองรับเสียง ข้ามได้
  }
}

export default function ShopPage() {
  const [mounted, setMounted] = useState(false)
  const [authReady, setAuthReady] = useState(false)
  const [user, setUser] = useState(null)
  const [shops, setShops] = useState([])
  const [shopsLoaded, setShopsLoaded] = useState(false)
  const [shopId, setShopId] = useState(null)
  const [orders, setOrders] = useState([])
  const [todayOrders, setTodayOrders] = useState([])
  const [menu, setMenu] = useState([])
  const [sound, setSound] = useState(false)
  const [newName, setNewName] = useState('')
  const [newPrice, setNewPrice] = useState('')
  const [claimCode, setClaimCode] = useState('')
  const [claiming, setClaiming] = useState(false)
  const [notice, setNotice] = useState(null)
  const [rejecting, setRejecting] = useState(null)
  const [reason, setReason] = useState(REASONS[0])
  const [pid, setPid] = useState('')
  const [mins, setMins] = useState('5')

  const soundRef = useRef(false)
  useEffect(() => {
    soundRef.current = sound
  }, [sound])

  useEffect(() => {
    setMounted(true)
  }, [])

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

  // ร้านที่บัญชีนี้ดูแล
  const loadShops = useCallback(async () => {
    if (!user) return
    const { data, error } = await supabase
      .from('shops')
      .select('id, name, is_open, promptpay_id, minutes_per_order')
      .eq('owner_id', user.id)
      .order('name')
    if (error) {
      setNotice({ type: 'error', text: 'โหลดข้อมูลร้านไม่สำเร็จ: ' + error.message })
    } else {
      const list = data || []
      setShops(list)
      setShopId((cur) => cur ?? list[0]?.id ?? null)
    }
    setShopsLoaded(true)
  }, [user])

  useEffect(() => {
    loadShops()
  }, [loadShops])

  const shop = shops.find((s) => s.id === shopId) || null

  // เติมค่าในฟอร์มตั้งค่าร้านเมื่อเปลี่ยนร้าน
  useEffect(() => {
    setPid(shop?.promptpay_id || '')
    setMins(String(shop?.minutes_per_order || 5))
  }, [shop?.id, shop?.promptpay_id, shop?.minutes_per_order])

  // ออเดอร์ที่กำลังดำเนินการ + ออเดอร์ที่แนบสลิปรอตรวจ
  const loadOrders = useCallback(async () => {
    if (!shopId) return
    const { data, error } = await supabase
      .from('orders')
      .select(
        'id, status, total_price, created_at, note, queue_no, payment_status, slip_path, tables(name), order_items(name, quantity, options)'
      )
      .eq('shop_id', shopId)
      .or('status.in.(new,cooking,ready),payment_status.eq.slip_sent')
      .order('created_at')
    if (error) {
      setNotice({ type: 'error', text: 'โหลดออเดอร์ไม่สำเร็จ: ' + error.message })
      return
    }
    setOrders(data || [])
  }, [shopId])

  // ยอดขายวันนี้
  const loadStats = useCallback(async () => {
    if (!shopId) return
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const { data } = await supabase
      .from('orders')
      .select('total_price, created_at, order_items(name, quantity)')
      .eq('shop_id', shopId)
      .neq('status', 'cancelled')
      .gte('created_at', start.toISOString())
    setTodayOrders(data || [])
  }, [shopId])

  const loadMenu = useCallback(async () => {
    if (!shopId) return
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
  }, [shopId])

  useEffect(() => {
    loadOrders()
    loadMenu()
    loadStats()
  }, [loadOrders, loadMenu, loadStats])

  // ออเดอร์ใหม่เข้ามาแบบเรียลไทม์ พร้อมเสียงแจ้งเตือน
  useEffect(() => {
    if (!shopId) return
    const channel = supabase
      .channel('shop-orders-' + shopId)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `shop_id=eq.${shopId}` },
        (payload) => {
          if (payload.eventType === 'INSERT' && soundRef.current) beep()
          loadOrders()
          loadStats()
        }
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [shopId, loadOrders, loadStats])

  // แสดงจำนวนออเดอร์ใหม่บนแท็บเบราว์เซอร์
  const newCount = orders.filter((o) => o.status === 'new').length
  useEffect(() => {
    document.title = newCount > 0 ? `(${newCount}) ออเดอร์ใหม่ · หน้าร้านค้า` : 'หน้าร้านค้า'
  }, [newCount])

  // สรุปยอดขายวันนี้
  const salesTotal = todayOrders.reduce((s, o) => s + Number(o.total_price), 0)
  const topItems = (() => {
    const map = {}
    todayOrders.forEach((o) =>
      (o.order_items || []).forEach((it) => {
        map[it.name] = (map[it.name] || 0) + Number(it.quantity)
      })
    )
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
  })()
  const byHour = (() => {
    const h = Array(24).fill(0)
    todayOrders.forEach((o) => {
      h[new Date(o.created_at).getHours()] += 1
    })
    return h
  })()
  const maxHour = Math.max(1, ...byHour)

  async function setStatus(id, status) {
    setNotice(null)
    const { error } = await supabase.from('orders').update({ status }).eq('id', id)
    if (error) {
      setNotice({ type: 'error', text: 'อัปเดตสถานะไม่สำเร็จ: ' + error.message })
      return
    }
    loadOrders()
    loadStats()
  }

  async function rejectOrder(id) {
    setNotice(null)
    const { error } = await supabase
      .from('orders')
      .update({ status: 'cancelled', reject_reason: reason })
      .eq('id', id)
    if (error) {
      setNotice({ type: 'error', text: 'ปฏิเสธออเดอร์ไม่สำเร็จ: ' + error.message })
      return
    }
    setRejecting(null)
    setReason(REASONS[0])
    loadOrders()
    loadStats()
  }

  async function toggleOpen() {
    if (!shop) return
    const { error } = await supabase.from('shops').update({ is_open: !shop.is_open }).eq('id', shop.id)
    if (error) {
      setNotice({ type: 'error', text: 'เปลี่ยนสถานะร้านไม่สำเร็จ: ' + error.message })
      return
    }
    loadShops()
  }

  async function saveSettings(e) {
    e.preventDefault()
    const digits = pid.replace(/\D/g, '')
    if (digits && ![9, 10, 13, 15].includes(digits.length)) {
      setNotice({ type: 'error', text: 'PromptPay ใส่เบอร์มือถือ 10 หลัก หรือเลขบัตรประชาชน 13 หลัก' })
      return
    }
    const m = Number(mins)
    if (!Number.isInteger(m) || m < 1 || m > 60) {
      setNotice({ type: 'error', text: 'เวลาต่อออเดอร์ใส่ 1–60 นาที' })
      return
    }
    const { error } = await supabase
      .from('shops')
      .update({ promptpay_id: digits || null, minutes_per_order: m })
      .eq('id', shop.id)
    if (error) {
      setNotice({ type: 'error', text: 'บันทึกการตั้งค่าไม่สำเร็จ: ' + error.message })
      return
    }
    setNotice({ type: 'ok', text: 'บันทึกการตั้งค่าร้านแล้ว' })
    loadShops()
  }

  async function toggleItem(item) {
    const { error } = await supabase
      .from('menu_items')
      .update({ is_available: !item.is_available })
      .eq('id', item.id)
    if (error) {
      setNotice({ type: 'error', text: 'แก้เมนูไม่สำเร็จ: ' + error.message })
      return
    }
    loadMenu()
  }

  async function toggleRecommended(item) {
    const { error } = await supabase
      .from('menu_items')
      .update({ is_recommended: !item.is_recommended })
      .eq('id', item.id)
    if (error) {
      setNotice({ type: 'error', text: 'แก้เมนูไม่สำเร็จ: ' + error.message })
      return
    }
    loadMenu()
  }

  async function addItem(e) {
    e.preventDefault()
    const price = Number(newPrice)
    if (!newName.trim() || !Number.isFinite(price) || price < 0) {
      setNotice({ type: 'error', text: 'กรอกชื่อเมนูและราคาให้ครบ' })
      return
    }
    const { error } = await supabase
      .from('menu_items')
      .insert({ shop_id: shopId, name: newName.trim(), price })
    if (error) {
      setNotice({ type: 'error', text: 'เพิ่มเมนูไม่สำเร็จ: ' + error.message })
      return
    }
    setNewName('')
    setNewPrice('')
    setNotice({ type: 'ok', text: 'เพิ่มเมนูแล้ว' })
    loadMenu()
  }

  async function addOption(e, itemId) {
    e.preventDefault()
    const form = e.currentTarget
    const data = new FormData(form)
    const name = String(data.get('name') || '').trim()
    const extra = Number(data.get('price') || 0)
    if (!name || !Number.isFinite(extra) || extra < 0) {
      setNotice({ type: 'error', text: 'กรอกชื่อตัวเลือก และราคาเพิ่ม (ใส่ 0 หรือเว้นว่างถ้าไม่เพิ่มราคา)' })
      return
    }
    const { error } = await supabase
      .from('menu_options')
      .insert({ menu_item_id: itemId, name, extra_price: extra })
    if (error) {
      setNotice({ type: 'error', text: 'เพิ่มตัวเลือกไม่สำเร็จ: ' + error.message })
      return
    }
    form.reset()
    setNotice({ type: 'ok', text: `เพิ่มตัวเลือก "${name}" แล้ว` })
    loadMenu()
  }

  async function toggleOption(opt) {
    const { error } = await supabase
      .from('menu_options')
      .update({ is_available: !opt.is_available })
      .eq('id', opt.id)
    if (error) {
      setNotice({ type: 'error', text: 'แก้ตัวเลือกไม่สำเร็จ: ' + error.message })
      return
    }
    loadMenu()
  }

  async function deleteOption(opt) {
    const { error } = await supabase.from('menu_options').delete().eq('id', opt.id)
    if (error) {
      setNotice({ type: 'error', text: 'ลบตัวเลือกไม่สำเร็จ: ' + error.message })
      return
    }
    loadMenu()
  }

  async function claimShop(e) {
    e.preventDefault()
    const code = claimCode.trim().toUpperCase()
    if (!code) return
    setClaiming(true)
    setNotice(null)
    const { data, error } = await supabase.rpc('claim_shop', { p_code: code })
    setClaiming(false)
    if (error || !data) {
      setNotice({
        type: 'error',
        text: 'รหัสร้านไม่ถูกต้อง หรือถูกใช้ไปแล้ว ตรวจสอบกับผู้ดูแลระบบอีกครั้ง',
      })
      return
    }
    setClaimCode('')
    setNotice({ type: 'ok', text: 'ผูกบัญชีกับร้านเรียบร้อยแล้ว' })
    setShopId(data)
    loadShops()
  }

  function turnOnSound() {
    const next = !sound
    setSound(next)
    if (next) beep()
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
        <AuthBox title="หน้าร้านค้า" subtitle="เข้าสู่ระบบเพื่อรับออเดอร์และจัดการเมนู" />
      </div>
    )
  }

  const slipWaiting = orders.filter((o) => o.payment_status === 'slip_sent' && o.status === 'done')

  return (
    <div className={styles.shell}>
      <main className={`${styles.page} ${styles.wide}`}>
        <header className={styles.top}>
          <div>
            <h1 className={styles.title}>หน้าร้านค้า</h1>
            <p className={styles.sub}>รับออเดอร์และจัดการเมนู</p>
          </div>
          <div className={styles.nav}>
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

        {shopsLoaded && shops.length === 0 && (
          <section aria-labelledby="h-claim">
            <h2 id="h-claim" className={styles.h2}>ผูกบัญชีกับร้านของคุณ</h2>
            <p className={styles.hint}>
              กรอกรหัสร้านที่ได้จากผู้ดูแลระบบ รหัสใช้ได้ครั้งเดียว ผูกแล้วจะเริ่มรับออเดอร์และจัดการเมนูได้ทันที
            </p>
            <form className={styles.claimForm} onSubmit={claimShop}>
              <input
                className={styles.input}
                aria-label="รหัสร้าน"
                placeholder="รหัสร้าน"
                autoCapitalize="characters"
                autoComplete="off"
                value={claimCode}
                onChange={(e) => setClaimCode(e.target.value)}
              />
              <button type="submit" className={styles.primary} disabled={claiming || !claimCode.trim()}>
                {claiming ? 'กำลังตรวจสอบ...' : 'ผูกบัญชี'}
              </button>
            </form>
          </section>
        )}

        {shops.length > 1 && (
          <div className={styles.chips} role="group" aria-label="เลือกร้าน">
            {shops.map((s) => (
              <button
                key={s.id}
                className={`${styles.chip} ${shopId === s.id ? styles.on : ''}`}
                aria-pressed={shopId === s.id}
                onClick={() => setShopId(s.id)}
              >
                {s.name}
              </button>
            ))}
          </div>
        )}

        {shop && (
          <>
            <TelegramLink userId={user.id} audience="shop" />
            <p className={styles.hint}>เปิดบอท Telegram แล้วพิมพ์ /menu เพื่อกดเปิด/ปิดเมนูที่หมดได้โดยไม่ต้องเปิดเว็บ</p>

            <section aria-labelledby="h-shop">
              <h2 id="h-shop" className={styles.h2}>{shop.name}</h2>
              <div className={styles.toggleRow}>
                <button className={styles.ghost} onClick={toggleOpen} aria-pressed={shop.is_open}>
                  {shop.is_open ? 'ร้านเปิดอยู่ (กดเพื่อปิดรับออเดอร์)' : 'ร้านปิดอยู่ (กดเพื่อเปิดรับออเดอร์)'}
                </button>
                <button className={styles.ghost} onClick={turnOnSound} aria-pressed={sound}>
                  {sound ? 'เสียงแจ้งเตือน: เปิด' : 'เสียงแจ้งเตือน: ปิด (กดเพื่อเปิด)'}
                </button>
              </div>
            </section>

            <section aria-labelledby="h-stats">
              <h2 id="h-stats" className={styles.h2}>สรุปยอดขายวันนี้</h2>
              <p>
                <strong>{baht(salesTotal)}</strong> จาก {todayOrders.length} ออเดอร์
              </p>
              {topItems.length > 0 && (
                <>
                  <h3 className={styles.colTitle}>เมนูขายดี</h3>
                  <ol>
                    {topItems.map(([name, qty]) => (
                      <li key={name}>
                        {name} × {qty}
                      </li>
                    ))}
                  </ol>
                  <h3 className={styles.colTitle}>ช่วงเวลาที่คนแน่น</h3>
                  <div style={{ display: 'grid', gap: 4 }}>
                    {byHour.map((c, h) =>
                      c > 0 ? (
                        <div key={h} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ width: 52 }}>{pad(h)}:00</span>
                          <div
                            style={{
                              height: 10,
                              width: `${(c / maxHour) * 100}%`,
                              minWidth: 6,
                              maxWidth: '70%',
                              background: '#e8590c',
                              borderRadius: 4,
                            }}
                          />
                          <span>{c}</span>
                        </div>
                      ) : null
                    )}
                  </div>
                </>
              )}
              {todayOrders.length === 0 && <p className={styles.hint}>วันนี้ยังไม่มีออเดอร์</p>}
            </section>

            <section aria-labelledby="h-settings">
              <h2 id="h-settings" className={styles.h2}>ตั้งค่าร้าน</h2>
              <form className={styles.addForm} onSubmit={saveSettings}>
                <input
                  className={styles.input}
                  aria-label="เบอร์ PromptPay หรือเลขบัตรประชาชน"
                  placeholder="PromptPay (เบอร์มือถือ/เลขบัตร)"
                  inputMode="numeric"
                  value={pid}
                  onChange={(e) => setPid(e.target.value)}
                />
                <input
                  className={styles.input}
                  aria-label="เวลาโดยประมาณต่อ 1 ออเดอร์ (นาที)"
                  placeholder="นาทีต่อออเดอร์"
                  inputMode="numeric"
                  value={mins}
                  onChange={(e) => setMins(e.target.value)}
                />
                <button type="submit" className={styles.primary}>
                  บันทึก
                </button>
              </form>
              <p className={styles.hint}>เวลาต่อออเดอร์ใช้คำนวณ "ประมาณกี่นาที" ที่ลูกค้าเห็นก่อนสั่ง</p>
            </section>

            <section aria-labelledby="h-board">
              <h2 id="h-board" className={styles.h2}>ออเดอร์</h2>
              <div className={styles.board}>
                {COLUMNS.map((col) => {
                  const list = orders.filter((o) => o.status === col.key)
                  return (
                    <div key={col.key} className={styles.col}>
                      <h3 className={styles.colTitle}>
                        {col.title} ({list.length})
                      </h3>
                      {list.length === 0 && <div className={styles.empty}>{col.empty}</div>}
                      {list.map((o) => (
                        <article key={o.id} className={styles.order}>
                          <div className={styles.orderHead}>
                            <strong>{orderRef(o)}</strong>
                            <span className={styles.orderMeta}>{hhmm(new Date(o.created_at))} น.</span>
                          </div>
                          <div className={styles.orderMeta}>
                            {o.tables?.name ? `ส่งที่โต๊ะ ${o.tables.name}` : 'ลูกค้ามารับที่ร้าน'}
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
                          <ShopPayment order={o} onChanged={loadOrders} />

                          {rejecting === o.id && (
                            <div className={styles.field}>
                              <label className={styles.label} htmlFor={`rs-${o.id}`}>เหตุผลที่ปฏิเสธ (ลูกค้าจะได้รับแจ้ง)</label>
                              <select
                                id={`rs-${o.id}`}
                                className={styles.select}
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                              >
                                {REASONS.map((r) => (
                                  <option key={r} value={r}>
                                    {r}
                                  </option>
                                ))}
                              </select>
                              <div className={styles.actions}>
                                <button className={styles.danger} onClick={() => rejectOrder(o.id)}>
                                  ยืนยันปฏิเสธ
                                </button>
                                <button className={styles.ghost} onClick={() => setRejecting(null)}>
                                  ไม่ปฏิเสธ
                                </button>
                              </div>
                            </div>
                          )}

                          <div className={styles.orderFoot}>
                            <strong>{baht(o.total_price)}</strong>
                            <div className={styles.actions}>
                              {o.status !== 'ready' && rejecting !== o.id && (
                                <button className={styles.danger} onClick={() => setRejecting(o.id)}>
                                  ปฏิเสธ
                                </button>
                              )}
                              <button className={styles.primary} onClick={() => setStatus(o.id, NEXT[o.status].to)}>
                                {NEXT[o.status].label}
                              </button>
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  )
                })}
              </div>
            </section>

            {slipWaiting.length > 0 && (
              <section aria-labelledby="h-slips">
                <h2 id="h-slips" className={styles.h2}>สลิปที่รอตรวจสอบ (ออเดอร์ที่ส่งมอบแล้ว)</h2>
                {slipWaiting.map((o) => (
                  <article key={o.id} className={styles.order}>
                    <div className={styles.orderHead}>
                      <strong>{orderRef(o)}</strong>
                      <strong>{baht(o.total_price)}</strong>
                    </div>
                    <ShopPayment order={o} onChanged={loadOrders} />
                  </article>
                ))}
              </section>
            )}

            <section aria-labelledby="h-menu">
              <h2 id="h-menu" className={styles.h2}>เมนูของร้าน</h2>
              <ul className={styles.list}>
                {menu.map((m) => {
                  const opts = [...(m.menu_options || [])].sort(
                    (a, b) =>
                      Number(a.extra_price) - Number(b.extra_price) || a.name.localeCompare(b.name, 'th')
                  )
                  return (
                    <li key={m.id} className={`${styles.itemBlock} ${!m.is_available ? styles.soldOut : ''}`}>
                      <div className={styles.itemRow}>
                        <div>
                          <div className={styles.itemName}>{m.name}</div>
                          <div className={styles.price}>{baht(m.price)}</div>
                        </div>
                        <div className={styles.actions}>
                          <button
                            className={styles.ghost}
                            onClick={() => toggleRecommended(m)}
                            aria-pressed={m.is_recommended}
                          >
                            {m.is_recommended ? '⭐ แนะนำอยู่ (กดเพื่อเอาออก)' : 'ติดป้ายแนะนำ'}
                          </button>
                          <button className={styles.ghost} onClick={() => toggleItem(m)} aria-pressed={m.is_available}>
                            {m.is_available ? 'มีขาย (กดเพื่อตั้งเป็นหมด)' : 'หมด (กดเพื่อเปิดขาย)'}
                          </button>
                        </div>
                      </div>

                      <details className={styles.opts}>
                        <summary>ตัวเลือกเสริม ({opts.length})</summary>
                        {opts.length > 0 && (
                          <ul className={styles.optList}>
                            {opts.map((o) => (
                              <li key={o.id} className={styles.optRow}>
                                <span>
                                  {o.name}{' '}
                                  <span className={styles.price}>
                                    {Number(o.extra_price) > 0 ? `+${baht(o.extra_price)}` : 'ฟรี'}
                                  </span>
                                  {!o.is_available && <span className={styles.gone}> หมด</span>}
                                </span>
                                <span className={styles.optBtns}>
                                  <button
                                    className={styles.ghost}
                                    onClick={() => toggleOption(o)}
                                    aria-pressed={o.is_available}
                                  >
                                    {o.is_available ? 'ตั้งเป็นหมด' : 'เปิดขาย'}
                                  </button>
                                  <button
                                    className={styles.danger}
                                    onClick={() => deleteOption(o)}
                                    aria-label={`ลบตัวเลือก ${o.name} ของ ${m.name}`}
                                  >
                                    ลบ
                                  </button>
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                        <form className={styles.optForm} onSubmit={(e) => addOption(e, m.id)}>
                          <input
                            className={styles.input}
                            name="name"
                            aria-label={`ชื่อตัวเลือกใหม่ของ ${m.name}`}
                            placeholder="เช่น เพิ่มไข่ดาว"
                          />
                          <input
                            className={styles.input}
                            name="price"
                            aria-label="ราคาที่เพิ่ม"
                            placeholder="+ราคา"
                            inputMode="decimal"
                          />
                          <button type="submit" className={styles.primary}>
                            เพิ่ม
                          </button>
                        </form>
                      </details>
                    </li>
                  )
                })}
              </ul>
              <form className={styles.addForm} onSubmit={addItem}>
                <input
                  className={styles.input}
                  aria-label="ชื่อเมนูใหม่"
                  placeholder="ชื่อเมนูใหม่"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
                <input
                  className={styles.input}
                  aria-label="ราคา"
                  placeholder="ราคา"
                  inputMode="decimal"
                  value={newPrice}
                  onChange={(e) => setNewPrice(e.target.value)}
                />
                <button type="submit" className={styles.primary}>
                  เพิ่มเมนู
                </button>
              </form>
            </section>
          </>
        )}
      </main>
    </div>
  )
}
