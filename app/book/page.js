'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../lib/supabaseClient'
import AuthBox from '../../components/AuthBox'
import styles from './book.module.css'

// ปรับเวลาเปิด-ปิด และความยาวต่อรอบได้ตรงนี้
const OPEN_HOUR = 10
const CLOSE_HOUR = 16
const SLOT_MINUTES = 60

const STATUS_TEXT = {
  idle: '',
  free: 'ว่าง',
  taken: 'ไม่ว่าง',
  mine: 'ของคุณ',
  pick: 'เลือกแล้ว',
}

const pad = (n) => String(n).padStart(2, '0')
const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`

function startOfDay(offset) {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + offset)
  return d
}

function buildSlots(day) {
  const slots = []
  for (let m = OPEN_HOUR * 60; m + SLOT_MINUTES <= CLOSE_HOUR * 60; m += SLOT_MINUTES) {
    const start = new Date(day)
    start.setHours(0, m, 0, 0)
    const end = new Date(start.getTime() + SLOT_MINUTES * 60000)
    slots.push({ key: start.toISOString(), start, end })
  }
  return slots
}

function SeatDots({ count }) {
  return (
    <span className={styles.dots} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <i key={i} />
      ))}
    </span>
  )
}

export default function BookPage() {
  const [mounted, setMounted] = useState(false)
  const [authReady, setAuthReady] = useState(false)
  const [user, setUser] = useState(null)
  const [tables, setTables] = useState([])
  const [reservations, setReservations] = useState([])
  const [dayOffset, setDayOffset] = useState(0)
  const [slotKey, setSlotKey] = useState(null)
  const [minSeats, setMinSeats] = useState(0)
  const [zone, setZone] = useState('all')
  const [selectedId, setSelectedId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState(null)

  // กัน hydration mismatch เพราะหน้านี้ใช้เวลาของเครื่องผู้ใช้
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

  // โหลดรายการโต๊ะ
  useEffect(() => {
    if (!user) return
    supabase
      .from('tables')
      .select('*')
      .then(({ data, error }) => {
        if (error) {
          setNotice({ type: 'error', text: 'โหลดข้อมูลโต๊ะไม่สำเร็จ: ' + error.message })
          return
        }
        const sorted = [...(data || [])].sort((a, b) =>
          a.name.localeCompare(b.name, 'th', { numeric: true })
        )
        setTables(sorted)
      })
  }, [user])

  const day = useMemo(() => startOfDay(dayOffset), [dayOffset])
  const slots = useMemo(() => buildSlots(day), [day])
  const slot = slots.find((s) => s.key === slotKey) || null

  // โหลดการจองของวันที่เลือก
  const loadReservations = useCallback(async () => {
    if (!user) return
    const next = new Date(day)
    next.setDate(next.getDate() + 1)
    const { data, error } = await supabase
      .from('reservations')
      .select('id, table_id, user_id, start_time, end_time')
      .eq('status', 'booked')
      .lt('start_time', next.toISOString())
      .gt('end_time', day.toISOString())
    if (error) {
      setNotice({ type: 'error', text: 'โหลดข้อมูลการจองไม่สำเร็จ: ' + error.message })
      return
    }
    setReservations(data || [])
  }, [user, day])

  useEffect(() => {
    loadReservations()
  }, [loadReservations])

  // อัปเดตผังโต๊ะแบบเรียลไทม์ (ต้องเปิด Realtime ให้ตาราง reservations ใน Supabase)
  useEffect(() => {
    if (!user) return
    const channel = supabase
      .channel('reservations-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reservations' }, () => {
        loadReservations()
      })
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [user, loadReservations])

  function statusOf(table) {
    if (!slot) return 'idle'
    const hit = reservations.find(
      (r) =>
        r.table_id === table.id &&
        new Date(r.start_time) < slot.end &&
        new Date(r.end_time) > slot.start
    )
    if (!hit) return 'free'
    return hit.user_id === user?.id ? 'mine' : 'taken'
  }

  function pickDay(offset) {
    setDayOffset(offset)
    setSlotKey(null)
    setSelectedId(null)
    setNotice(null)
  }

  function pickSlot(s) {
    setSlotKey(s.key)
    setSelectedId(null)
    setNotice(null)
  }

  function tapTable(table, status) {
    setNotice(null)
    if (status === 'idle') {
      setNotice({ type: 'info', text: 'เลือกเวลาก่อน แล้วค่อยแตะโต๊ะที่ว่าง' })
      return
    }
    if (status === 'taken') return
    if (status === 'mine') {
      setNotice({ type: 'info', text: `คุณจองโต๊ะ ${table.name} รอบนี้ไว้แล้ว ยกเลิกได้ที่รายการด้านล่าง` })
      return
    }
    setSelectedId((cur) => (cur === table.id ? null : table.id))
  }

  async function book() {
    if (!selectedTable || !slot) return
    setSaving(true)
    setNotice(null)
    const { error } = await supabase.from('reservations').insert({
      table_id: selectedTable.id,
      user_id: user.id,
      start_time: slot.start.toISOString(),
      end_time: slot.end.toISOString(),
    })
    setSaving(false)
    if (error) {
      const text =
        error.code === '23P01'
          ? `โต๊ะ ${selectedTable.name} เพิ่งถูกจองไปแล้ว เลือกโต๊ะอื่นได้เลย`
          : 'จองไม่สำเร็จ: ' + error.message
      setNotice({ type: 'error', text })
      setSelectedId(null)
      loadReservations()
      return
    }
    setNotice({
      type: 'ok',
      text: `จองโต๊ะ ${selectedTable.name} สำเร็จ เวลา ${hhmm(slot.start)}–${hhmm(slot.end)}`,
    })
    setSelectedId(null)
    loadReservations()
  }

  async function cancel(id) {
    setNotice(null)
    const { error } = await supabase.from('reservations').update({ status: 'cancelled' }).eq('id', id)
    if (error) {
      setNotice({ type: 'error', text: 'ยกเลิกไม่สำเร็จ: ' + error.message })
      return
    }
    setNotice({ type: 'ok', text: 'ยกเลิกการจองแล้ว' })
    loadReservations()
  }

  const zones = useMemo(
    () => [...new Set(tables.map((t) => t.zone).filter(Boolean))],
    [tables]
  )

  const visible = tables.filter(
    (t) => t.seats >= minSeats && (zone === 'all' || t.zone === zone)
  )

  const grouped = visible.reduce((acc, t) => {
    const key = t.zone || 'โซนอื่น ๆ'
    ;(acc[key] = acc[key] || []).push(t)
    return acc
  }, {})

  const selectedTable = tables.find((t) => t.id === selectedId) || null
  const canBook = Boolean(selectedTable && slot && statusOf(selectedTable) === 'free')

  const mine = reservations
    .filter((r) => r.user_id === user?.id)
    .sort((a, b) => new Date(a.start_time) - new Date(b.start_time))

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

  const now = new Date()

  return (
    <div className={styles.shell}>
      <main className={styles.page}>
        <header className={styles.top}>
          <div>
            <h1 className={styles.title}>จองโต๊ะโรงอาหาร</h1>
            <p className={styles.sub}>เลือกวัน เวลา แล้วแตะโต๊ะที่ว่าง</p>
          </div>
          <div className={styles.nav}>
            <Link href="/order" className={styles.ghost}>
              สั่งอาหาร
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

        <section aria-labelledby="h-time">
          <h2 id="h-time" className={styles.h2}>เลือกเวลา</h2>
          <div className={styles.days}>
            {[0, 1].map((o) => (
              <button
                key={o}
                className={`${styles.day} ${dayOffset === o ? styles.on : ''}`}
                aria-pressed={dayOffset === o}
                onClick={() => pickDay(o)}
              >
                <strong>{o === 0 ? 'วันนี้' : 'พรุ่งนี้'}</strong>
                <span>
                  {startOfDay(o).toLocaleDateString('th-TH', {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                  })}
                </span>
              </button>
            ))}
          </div>
          <div className={styles.slots}>
            {slots.map((s) => {
              const past = s.end <= now
              return (
                <button
                  key={s.key}
                  className={`${styles.slot} ${slotKey === s.key ? styles.on : ''}`}
                  aria-pressed={slotKey === s.key}
                  disabled={past}
                  onClick={() => pickSlot(s)}
                >
                  {hhmm(s.start)}–{hhmm(s.end)}
                </button>
              )
            })}
          </div>
        </section>

        <section aria-labelledby="h-table">
          <h2 id="h-table" className={styles.h2}>เลือกโต๊ะ</h2>

          <div className={styles.chips} role="group" aria-label="กรองตามจำนวนที่นั่ง">
            {[0, 2, 4, 6].map((n) => (
              <button
                key={n}
                className={`${styles.chip} ${minSeats === n ? styles.on : ''}`}
                aria-pressed={minSeats === n}
                onClick={() => setMinSeats(n)}
              >
                {n === 0 ? 'ทุกขนาด' : `${n} ที่นั่งขึ้นไป`}
              </button>
            ))}
          </div>

          {zones.length > 0 && (
            <div className={styles.chips} role="group" aria-label="กรองตามโซน">
              <button
                className={`${styles.chip} ${zone === 'all' ? styles.on : ''}`}
                aria-pressed={zone === 'all'}
                onClick={() => setZone('all')}
              >
                ทุกโซน
              </button>
              {zones.map((z) => (
                <button
                  key={z}
                  className={`${styles.chip} ${zone === z ? styles.on : ''}`}
                  aria-pressed={zone === z}
                  onClick={() => setZone(z)}
                >
                  {z}
                </button>
              ))}
            </div>
          )}

          <ul className={styles.legend} aria-label="สัญลักษณ์สถานะโต๊ะ">
            <li className={styles.free}>ว่าง</li>
            <li className={styles.taken}>ไม่ว่าง</li>
            <li className={styles.mine}>ของคุณ</li>
            <li className={styles.pick}>เลือกแล้ว</li>
          </ul>

          {!slot && <p className={styles.hint}>เลือกเวลาด้านบนก่อน โต๊ะจะแสดงสถานะว่างหรือไม่ว่างตามรอบนั้น</p>}

          {tables.length === 0 && <p className={styles.hint}>ยังไม่มีโต๊ะในระบบ เพิ่มโต๊ะในตาราง tables ที่ Supabase</p>}

          {Object.entries(grouped).map(([zoneName, list]) => (
            <div key={zoneName} className={styles.zone}>
              <h3 className={styles.h3}>{zoneName}</h3>
              <div className={styles.grid}>
                {list.map((t) => {
                  const status = statusOf(t)
                  const display = selectedId === t.id && status === 'free' ? 'pick' : status
                  const top = Math.ceil(t.seats / 2)
                  const bottom = Math.floor(t.seats / 2)
                  return (
                    <button
                      key={t.id}
                      className={`${styles.table} ${styles[display]}`}
                      aria-pressed={display === 'pick'}
                      aria-disabled={display === 'taken'}
                      aria-label={`โต๊ะ ${t.name} ${t.seats} ที่นั่ง ${STATUS_TEXT[display]}`}
                      onClick={() => tapTable(t, status)}
                    >
                      <SeatDots count={top} />
                      <span className={styles.tableName}>{t.name}</span>
                      <span className={styles.tableStatus}>
                        {STATUS_TEXT[display] || `${t.seats} ที่นั่ง`}
                      </span>
                      <SeatDots count={bottom} />
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </section>

        {mine.length > 0 && (
          <section aria-labelledby="h-mine">
            <h2 id="h-mine" className={styles.h2}>การจองของฉัน (วันที่เลือก)</h2>
            <ul className={styles.mineList}>
              {mine.map((r) => {
                const t = tables.find((x) => x.id === r.table_id)
                return (
                  <li key={r.id} className={styles.mineRow}>
                    <span>
                      โต๊ะ {t?.name ?? ''} เวลา {hhmm(new Date(r.start_time))}–{hhmm(new Date(r.end_time))}
                    </span>
                    <button className={styles.ghost} onClick={() => cancel(r.id)}>
                      ยกเลิกการจอง
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        )}
      </main>

      {canBook && (
        <div className={styles.bar}>
          <div className={styles.barInner}>
            <div>
              <strong>โต๊ะ {selectedTable.name}</strong>
              <div className={styles.barSub}>
                {selectedTable.seats} ที่นั่ง เวลา {hhmm(slot.start)}–{hhmm(slot.end)}
              </div>
            </div>
            <button className={styles.confirm} onClick={book} disabled={saving}>
              {saving ? 'กำลังจอง...' : `ยืนยันจองโต๊ะ ${selectedTable.name}`}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
