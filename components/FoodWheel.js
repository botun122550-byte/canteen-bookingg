'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import styles from './FoodWheel.module.css'

const MAX_SEGMENTS = 10
const COLORS = ['#ffb26b', '#fff1e3', '#ff8a3d']
const SIZE = 320
const C = SIZE / 2
const R = C - 8
const SPIN_MS = 4500

const baht = (n) => `฿${Number(n).toLocaleString('th-TH')}`

// มุมวัดจากบนสุด (12 นาฬิกา) หมุนตามเข็มนาฬิกา
function polar(angleDeg, radius) {
  const a = (angleDeg * Math.PI) / 180
  return [C + radius * Math.sin(a), C - radius * Math.cos(a)]
}

function slicePath(startDeg, endDeg) {
  const [x1, y1] = polar(startDeg, R)
  const [x2, y2] = polar(endDeg, R)
  const large = endDeg - startDeg > 180 ? 1 : 0
  return `M ${C} ${C} L ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2} Z`
}

function shuffle(list) {
  const a = [...list]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function shortName(name) {
  const chars = Array.from(String(name))
  return chars.length > 11 ? chars.slice(0, 10).join('') + '…' : chars.join('')
}

export default function FoodWheel({ shops = [], shopId = null, onPick }) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [scope, setScope] = useState('all')
  const [seed, setSeed] = useState(0)
  const [rot, setRot] = useState(0)
  const [dur, setDur] = useState(SPIN_MS)
  const [spinning, setSpinning] = useState(false)
  const [winner, setWinner] = useState(null)
  const timer = useRef(null)

  // โหลดเมนูที่ยังมีอยู่ครั้งเดียว ตอนเปิดวงล้อครั้งแรก
  useEffect(() => {
    if (!open || loaded) return
    setLoading(true)
    supabase
      .from('menu_items')
      .select('id, name, price, shop_id')
      .eq('is_available', true)
      .then(({ data }) => {
        setItems(data || [])
        setLoaded(true)
        setLoading(false)
      })
  }, [open, loaded])

  useEffect(() => () => clearTimeout(timer.current), [])

  const shopName = useMemo(() => Object.fromEntries(shops.map((s) => [s.id, s.name])), [shops])

  // เมนูที่สุ่มได้: เฉพาะร้านที่เปิดอยู่ (และตามขอบเขตที่เลือก)
  const pool = useMemo(() => {
    const openIds = new Set(shops.filter((s) => s.is_open).map((s) => s.id))
    return items.filter((i) => openIds.has(i.shop_id) && (scope === 'all' || i.shop_id === shopId))
  }, [items, shops, scope, shopId])

  // เมนูบนวงล้อ (สูงสุด MAX_SEGMENTS)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const segments = useMemo(() => shuffle(pool).slice(0, MAX_SEGMENTS), [pool, seed])

  useEffect(() => {
    setWinner(null)
  }, [segments])

  function spin() {
    if (spinning || segments.length < 2) return
    const n = segments.length
    const seg = 360 / n
    const idx = Math.floor(Math.random() * n)
    const jitter = (Math.random() - 0.5) * seg * 0.7
    const center = idx * seg + seg / 2
    const current = ((rot % 360) + 360) % 360
    // หมุนให้ช่องที่ได้มาหยุดตรงลูกศรด้านบน
    const delta = (((360 - center - jitter - current) % 360) + 360) % 360
    const reduce =
      typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const ms = reduce ? 600 : SPIN_MS

    setWinner(null)
    setDur(ms)
    setSpinning(true)
    setRot(rot + 360 * 5 + delta)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      setSpinning(false)
      setWinner(segments[idx])
    }, ms + 150)
  }

  const n = segments.length
  const seg = n > 0 ? 360 / n : 0
  const fontSize = n <= 6 ? 15 : n <= 8 ? 13 : 12

  return (
    <section className={styles.card} aria-labelledby="h-wheel">
      <div className={styles.head}>
        <div>
          <h2 id="h-wheel" className={styles.title}>🎡 วันนี้กินอะไรดี?</h2>
          <p className={styles.sub}>ตัดสินใจไม่ได้ ให้วงล้อช่วยเลือก</p>
        </div>
        <button className={styles.toggle} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? 'ซ่อน' : 'เปิดวงล้อ'}
        </button>
      </div>

      {open && (
        <div className={styles.body}>
          {loading && <p className={styles.hint}>กำลังโหลดเมนู...</p>}

          {!loading && shopId && (
            <div className={styles.scope} role="group" aria-label="ขอบเขตการสุ่ม">
              <button
                className={`${styles.scopeBtn} ${scope === 'all' ? styles.on : ''}`}
                aria-pressed={scope === 'all'}
                disabled={spinning}
                onClick={() => setScope('all')}
              >
                ทุกร้าน
              </button>
              <button
                className={`${styles.scopeBtn} ${scope === 'shop' ? styles.on : ''}`}
                aria-pressed={scope === 'shop'}
                disabled={spinning}
                onClick={() => setScope('shop')}
              >
                เฉพาะ{shopName[shopId] ? `ร้าน${shopName[shopId]}` : 'ร้านที่เลือก'}
              </button>
            </div>
          )}

          {!loading && loaded && pool.length < 2 && (
            <p className={styles.hint}>
              ตอนนี้มีเมนูที่สั่งได้ไม่ถึง 2 อย่าง วงล้อเลยยังหมุนไม่ได้ ลองเลือก "ทุกร้าน" หรือรอร้านเปิดเพิ่ม
            </p>
          )}

          {!loading && pool.length >= 2 && (
            <>
              <div className={styles.wheelWrap}>
                <div className={styles.pointer} aria-hidden="true" />
                <svg
                  viewBox={`0 0 ${SIZE} ${SIZE}`}
                  className={styles.svg}
                  role="img"
                  aria-label="วงล้อสุ่มเมนูอาหาร"
                >
                  <g
                    style={{
                      transformOrigin: `${C}px ${C}px`,
                      transform: `rotate(${rot}deg)`,
                      transition: spinning ? `transform ${dur}ms cubic-bezier(0.12, 0.7, 0.1, 1)` : 'none',
                    }}
                  >
                    {segments.map((m, i) => {
                      const start = i * seg
                      const end = (i + 1) * seg
                      const c = start + seg / 2
                      let ci = i % COLORS.length
                      if (i === n - 1 && ci === 0) ci = 1
                      const right = c <= 180
                      return (
                        <g key={m.id}>
                          <path d={slicePath(start, end)} fill={COLORS[ci]} stroke="#ffffff" strokeWidth="2" />
                          <text
                            transform={`rotate(${right ? c - 90 : c + 90} ${C} ${C})`}
                            x={right ? C + R * 0.28 : C - R * 0.28}
                            y={C}
                            textAnchor={right ? 'start' : 'end'}
                            dominantBaseline="central"
                            fontSize={fontSize}
                            fontWeight="600"
                            fill="#33261c"
                          >
                            {shortName(m.name)}
                          </text>
                        </g>
                      )
                    })}
                  </g>
                  <circle cx={C} cy={C} r={R} fill="none" stroke="#d9560b" strokeWidth="6" />
                  <circle cx={C} cy={C} r="22" fill="#ffffff" stroke="#d9560b" strokeWidth="4" />
                </svg>
              </div>

              <button className={styles.spin} onClick={spin} disabled={spinning}>
                {spinning ? 'กำลังหมุน...' : winner ? 'หมุนใหม่' : 'หมุนเลย!'}
              </button>

              {pool.length > MAX_SEGMENTS && (
                <p className={styles.hint}>
                  แสดง {MAX_SEGMENTS} จาก {pool.length} เมนู{' '}
                  <button
                    className={styles.link}
                    disabled={spinning}
                    onClick={() => setSeed((s) => s + 1)}
                  >
                    สุ่มชุดเมนูใหม่
                  </button>
                </p>
              )}

              <div className={styles.result} role="status" aria-live="polite">
                {winner ? (
                  <>
                    <p className={styles.resultLabel}>วันนี้กินนี่แหละ!</p>
                    <p className={styles.resultName}>{winner.name}</p>
                    <p className={styles.resultMeta}>
                      ร้าน{shopName[winner.shop_id] ?? ''} · {baht(winner.price)}
                    </p>
                    <button className={styles.go} onClick={() => onPick?.(winner.shop_id, winner.id)}>
                      ไปสั่งเลย
                    </button>
                  </>
                ) : (
                  <p className={styles.hint}>{spinning ? 'ลุ้นอยู่นะ...' : 'กดปุ่มหมุนเพื่อเริ่ม'}</p>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  )
}
