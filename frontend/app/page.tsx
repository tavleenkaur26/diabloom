'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import axios from 'axios'
import {
  ComposedChart, Line, Area, XAxis, YAxis, ReferenceLine,
  ResponsiveContainer, Tooltip, Legend
} from 'recharts'

const fontLink = `@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@400;500;600;700&display=swap');`

interface Prediction {
  predicted_glucose: number
  alert_level: 'OK' | 'WARNING' | 'CRITICAL'
  message: string
  explanation: string
  iob?: { iob_units: number; risk_level: string; message: string } | null
  error_margin: number
}

interface GlucosePoint {
  time: string
  actual: number | null
  forecast: number | null
  bridge: number | null
}

interface NutritionData {
  identified_foods?: string[]
  carbs_g: number; fat_g: number; protein_g: number
  gi_score: number; estimated_impact: string
  peak_time_mins: number; notes: string
}

function getTrendArrow(r: number[]) {
  if (r.length < 4) return '→'
  const d = r[r.length - 1] - r[r.length - 4]
  if (d > 8) return '↑'; if (d > 3) return '↗'
  if (d < -8) return '↓'; if (d < -3) return '↘'
  return '→'
}

function getTrendLabel(arrow: string) {
  if (arrow === '↑' || arrow === '↗') return 'rising'
  if (arrow === '↓' || arrow === '↘') return 'dropping'
  return 'stable'
}

function getZoneColor(g: number) {
  if (g < 70) return '#f87171'
  if (g < 85) return '#fbbf24'
  if (g <= 180) return '#34d399'
  if (g <= 250) return '#fbbf24'
  return '#f87171'
}

async function fetchRealReadings() {
  try {
    const res = await axios.get('http://127.0.0.1:8000/mydata/latest')
    return { readings: res.data.readings as number[], timestamps: res.data.timestamps as string[] }
  } catch {
    const readings = Array.from({ length: 24 }, (_, i) =>
      Math.max(55, 130 - i * 1.2 + (Math.random() - 0.5) * 10))
    return { readings, timestamps: [] }
  }
}

function GlucoseTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const items = payload.filter((p: any) => p.value !== null && p.value !== undefined)
  if (!items.length) return null
  return (
    <div style={{
      background: '#13131f', border: '1px solid rgba(139,92,246,0.3)',
      borderRadius: 8, padding: '10px 16px',
      fontFamily: '"DM Mono", monospace', fontSize: 12
    }}>
      <div style={{ color: '#94a3b8', marginBottom: 6, fontSize: 11 }}>{label}</div>
      {items.map((p: any) => (
        <div key={p.dataKey} style={{
          color: p.dataKey === 'forecast' ? '#a78bfa' : '#60a5fa',
          marginBottom: 2
        }}>
          {p.dataKey === 'forecast' ? '◌ forecast' : '● actual'}: <strong>{Math.round(p.value)}</strong> mg/dL
        </div>
      ))}
    </div>
  )
}

function MealPanel({ onMealLogged }: { onMealLogged: () => void }) {
  const [mode, setMode] = useState<'text' | 'photo'>('text')
  const [desc, setDesc] = useState('')
  const [nutrition, setNutrition] = useState<NutritionData | null>(null)
  const [loading, setLoading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const analyseText = async () => {
    if (!desc.trim()) return
    setLoading(true); setNutrition(null)
    try {
      const res = await axios.post('http://127.0.0.1:8000/meal/analyse',
        { description: desc, patient_id: '550e8400-e29b-41d4-a716-446655440000' })
      setNutrition(res.data.nutrition)
      onMealLogged()
    } finally { setLoading(false) }
  }

  const analysePhoto = async (file: File) => {
    setLoading(true); setNutrition(null)
    try {
      const base64 = await new Promise<string>((res, rej) => {
        const r = new FileReader()
        r.onload = () => res((r.result as string).split(',')[1])
        r.onerror = rej; r.readAsDataURL(file)
      })
      const resp = await axios.post('http://127.0.0.1:8000/meal/analyse-photo',
        { image_base64: base64, patient_id: '550e8400-e29b-41d4-a716-446655440000' })
      setNutrition(resp.data.nutrition)
      onMealLogged()
    } finally { setLoading(false) }
  }

  const impactColor: Record<string, string> = {
    'low spike': '#34d399', 'moderate spike': '#fbbf24', 'high spike': '#f87171'
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {(['text', 'photo'] as const).map(m => (
          <button key={m} onClick={() => setMode(m)} style={{
            fontFamily: '"DM Mono", monospace', fontSize: 12,
            padding: '6px 16px', borderRadius: 6, cursor: 'pointer',
            border: `1px solid ${mode === m ? 'rgba(139,92,246,0.6)' : 'rgba(255,255,255,0.1)'}`,
            background: mode === m ? 'rgba(139,92,246,0.15)' : 'transparent',
            color: mode === m ? '#c4b5fd' : '#94a3b8'
          }}>{m === 'text' ? '/ text' : '◉ photo'}</button>
        ))}
      </div>

      {mode === 'text' ? (
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={desc} onChange={e => setDesc(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && analyseText()}
            placeholder="2 rotis, dal, rice, curd..."
            style={{
              flex: 1, background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 8, padding: '10px 14px',
              fontFamily: '"DM Mono", monospace', fontSize: 13,
              color: '#e2e8f0', outline: 'none'
            }} />
          <button onClick={analyseText} disabled={loading || !desc.trim()} style={{
            background: 'rgba(139,92,246,0.2)', border: '1px solid rgba(139,92,246,0.4)',
            borderRadius: 8, padding: '10px 20px',
            fontFamily: '"Syne", sans-serif', fontSize: 12, fontWeight: 600,
            color: '#c4b5fd', cursor: 'pointer', opacity: loading || !desc.trim() ? 0.4 : 1
          }}>{loading ? '...' : 'analyse'}</button>
        </div>
      ) : (
        <div>
          <input ref={fileRef} type="file" accept="image/*" capture="environment"
            onChange={e => e.target.files?.[0] && analysePhoto(e.target.files[0])}
            style={{ display: 'none' }} />
          <button onClick={() => fileRef.current?.click()} disabled={loading} style={{
            width: '100%', background: 'rgba(255,255,255,0.02)',
            border: '1px dashed rgba(139,92,246,0.35)', borderRadius: 8,
            padding: '24px', fontFamily: '"DM Mono", monospace',
            fontSize: 13, color: '#94a3b8', cursor: 'pointer'
          }}>{loading ? 'analysing...' : '◉ click to upload meal photo'}</button>
        </div>
      )}

      {nutrition && (
        <div style={{
          marginTop: 16, background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 10, padding: '16px 18px'
        }}>
          {nutrition.identified_foods && (
            <div style={{ fontFamily: '"DM Mono", monospace', fontSize: 11, color: '#94a3b8', marginBottom: 10 }}>
              detected — {nutrition.identified_foods.join(', ')}
            </div>
          )}
          <div style={{
            fontFamily: '"Syne", sans-serif', fontSize: 15, fontWeight: 600,
            color: impactColor[nutrition.estimated_impact] || '#e2e8f0', marginBottom: 16
          }}>
            {nutrition.estimated_impact} · peaks ~{nutrition.peak_time_mins} min
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 14 }}>
            {[
              { label: 'carbs', value: `${nutrition.carbs_g}g`, color: '#fb923c' },
              { label: 'fat', value: `${nutrition.fat_g}g`, color: '#fbbf24' },
              { label: 'protein', value: `${nutrition.protein_g}g`, color: '#60a5fa' },
              { label: 'GI', value: String(nutrition.gi_score), color: '#a78bfa' },
            ].map(item => (
              <div key={item.label} style={{ textAlign: 'center' }}>
                <div style={{ fontFamily: '"DM Mono", monospace', fontSize: 20, color: item.color }}>{item.value}</div>
                <div style={{ fontFamily: '"Syne", sans-serif', fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: 2 }}>{item.label}</div>
              </div>
            ))}
          </div>
          <div style={{ fontFamily: '"DM Mono", monospace', fontSize: 11, color: '#94a3b8', lineHeight: 1.7 }}>
            {nutrition.notes}
          </div>
        </div>
      )}
    </div>
  )
}

function ActivityPanel({ onActivityLogged }: { onActivityLogged: () => void }) {
  const [activity, setActivity] = useState('exercise')
  const [intensity, setIntensity] = useState<'light' | 'moderate' | 'intense' | ''>('')
  const [duration, setDuration] = useState(30)
  const [result, setResult] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  const logActivity = async () => {
    if (!intensity) return
    setLoading(true)
    try {
      const res = await axios.post('http://127.0.0.1:8000/activity/log',
        { activity_type: activity, intensity, duration_mins: duration, patient_id: '550e8400-e29b-41d4-a716-446655440000' })
      setResult(res.data)
      onActivityLogged()
    } finally { setLoading(false) }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        {['exercise', 'walk', 'sport', 'other'].map(a => (
          <button key={a} onClick={() => setActivity(a)} style={{
            fontFamily: '"DM Mono", monospace', fontSize: 12,
            padding: '6px 14px', borderRadius: 6, cursor: 'pointer',
            border: `1px solid ${activity === a ? 'rgba(139,92,246,0.6)' : 'rgba(255,255,255,0.1)'}`,
            background: activity === a ? 'rgba(139,92,246,0.15)' : 'transparent',
            color: activity === a ? '#c4b5fd' : '#94a3b8'
          }}>{a}</button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {[
          { key: 'light', color: '#34d399' },
          { key: 'moderate', color: '#fbbf24' },
          { key: 'intense', color: '#f87171' }
        ].map(({ key, color }) => (
          <button key={key} onClick={() => setIntensity(key as any)} style={{
            flex: 1, fontFamily: '"Syne", sans-serif', fontSize: 11,
            fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em',
            padding: '9px', borderRadius: 8, cursor: 'pointer', border: 'none',
            background: intensity === key ? `${color}18` : 'rgba(255,255,255,0.03)',
            color: intensity === key ? color : '#64748b',
            outline: intensity === key ? `1px solid ${color}55` : '1px solid rgba(255,255,255,0.07)'
          }}>{key}</button>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <span style={{ fontFamily: '"DM Mono", monospace', fontSize: 12, color: '#94a3b8', minWidth: 56 }}>duration</span>
        <input type="range" min={5} max={120} step={5} value={duration}
          onChange={e => setDuration(Number(e.target.value))}
          style={{ flex: 1, accentColor: '#8b5cf6' }} />
        <span style={{ fontFamily: '"DM Mono", monospace', fontSize: 13, color: '#c4b5fd', minWidth: 52, textAlign: 'right' }}>
          {duration} min
        </span>
      </div>

      <button onClick={logActivity} disabled={!intensity || loading} style={{
        width: '100%', background: 'rgba(139,92,246,0.12)',
        border: '1px solid rgba(139,92,246,0.3)', borderRadius: 8,
        padding: '10px', fontFamily: '"Syne", sans-serif',
        fontSize: 12, fontWeight: 600, color: '#c4b5fd',
        cursor: 'pointer', opacity: !intensity || loading ? 0.4 : 1
      }}>{loading ? 'logging...' : 'log activity'}</button>

      {result && (
        <div style={{
          marginTop: 14, padding: '14px 16px',
          background: 'rgba(251,191,36,0.06)',
          border: '1px solid rgba(251,191,36,0.2)', borderRadius: 8
        }}>
          <div style={{ fontFamily: '"Syne", sans-serif', fontSize: 13, color: '#fbbf24', fontWeight: 600 }}>
            ◈ {result.risk_window}
          </div>
          <div style={{ fontFamily: '"DM Mono", monospace', fontSize: 12, color: '#94a3b8', marginTop: 6 }}>
            {result.advice}
          </div>
        </div>
      )}
    </div>
  )
}

export default function Dashboard() {
  const [readings, setReadings] = useState<number[]>([])
  const [chartData, setChartData] = useState<GlucosePoint[]>([])
  const [prediction, setPrediction] = useState<Prediction | null>(null)
  const [loading, setLoading] = useState(false)
  const [lastUpdate, setLastUpdate] = useState('')
  const [activeTab, setActiveTab] = useState<'meal' | 'activity'>('meal')
  const [mealsToday, setMealsToday] = useState(0)
  const [activitiesLogged, setActivitiesLogged] = useState(0)

  const current = readings.length ? Math.round(readings[readings.length - 1]) : null
  const trend = getTrendArrow(readings)
  const glucoseColor = current ? getZoneColor(current) : '#60a5fa'
  const tirPct = readings.length ? Math.round(readings.filter(r => r >= 70 && r <= 180).length / readings.length * 100) : 0
  const meanGlc = readings.length ? Math.round(readings.reduce((a, b) => a + b, 0) / readings.length) : 0
  const hypoCount = readings.filter(r => r < 70).length
  const hyperCount = readings.filter(r => r > 180).length

  const fetchPrediction = useCallback(async (r: number[]) => {
    setLoading(true)
    try {
      const res = await axios.post('http://127.0.0.1:8000/predict/fast', { readings: r, patient_id: 'demo' })
      setPrediction(res.data)
    } catch { } finally { setLoading(false) }
  }, [])

  const buildChart = useCallback((r: number[], pred: Prediction | null) => {
    const now = new Date()
    const chart: GlucosePoint[] = r.map((g, i) => ({
      time: new Date(now.getTime() - (23 - i) * 5 * 60000)
        .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      actual: Math.round(g),
      forecast: null,
      bridge: null
    }))
    if (pred) {
      // bridge point — connects actual line to forecast dot
      chart[chart.length - 1].bridge = Math.round(r[r.length - 1])
      chart.push({
        time: new Date(now.getTime() + 30 * 60000)
          .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        actual: null,
        forecast: pred.predicted_glucose,
        bridge: pred.predicted_glucose
      })
    }
    setChartData(chart)
  }, [])

  const update = useCallback(async () => {
    const { readings: r } = await fetchRealReadings()
    setReadings(r)
    setLastUpdate(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
    const res = await axios.post('http://127.0.0.1:8000/predict/fast', { readings: r, patient_id: 'demo' })
      .catch(() => null)
    const pred = res?.data ?? null
    setPrediction(pred)
    buildChart(r, pred)
    setLoading(false)
  }, [buildChart])

  useEffect(() => { update() }, [])
  useEffect(() => { const id = setInterval(update, 30000); return () => clearInterval(id) }, [update])

  const alertColors = {
    OK: { bg: 'transparent', border: 'transparent', text: 'transparent' },
    WARNING: { bg: 'rgba(251,191,36,0.07)', border: 'rgba(251,191,36,0.35)', text: '#fbbf24' },
    CRITICAL: { bg: 'rgba(248,113,113,0.08)', border: 'rgba(248,113,113,0.4)', text: '#f87171' },
  }
  const ac = prediction ? alertColors[prediction.alert_level] : alertColors.OK

  return (
    <>
      <style>{fontLink}</style>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #080810; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.15} }
        input::placeholder { color: #475569; }
        button { transition: opacity 0.15s; }
      `}</style>

      <div style={{ minHeight: '100vh', background: '#080810', color: '#e2e8f0', fontFamily: '"Syne", sans-serif' }}>

        {/* alert banner */}
        {prediction && prediction.alert_level !== 'OK' && (
          <div style={{
            background: ac.bg, borderBottom: `1px solid ${ac.border}`,
            padding: '12px 40px', display: 'flex', alignItems: 'center', gap: 14
          }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
              background: ac.text, display: 'inline-block',
              animation: 'pulse 1.4s infinite'
            }} />
            <span style={{ fontFamily: '"DM Mono", monospace', fontSize: 13, color: ac.text, fontWeight: 500 }}>
              {prediction.message}
            </span>
            {prediction.explanation && (
              <span style={{ fontFamily: '"DM Mono", monospace', fontSize: 12, color: '#94a3b8' }}>
                — {prediction.explanation}
              </span>
            )}
          </div>
        )}

        {/* navbar */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '18px 48px',
          borderBottom: '1px solid rgba(255,255,255,0.05)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
            <span style={{ fontFamily: '"Syne", sans-serif', fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>
              diab<span style={{ color: '#8b5cf6' }}>loom</span>
            </span>
            <span style={{ fontFamily: '"DM Mono", monospace', fontSize: 11, color: '#475569', letterSpacing: '0.1em' }}>
              T1D COPILOT · {loading ? 'syncing...' : `updated ${lastUpdate}`}
            </span>
          </div>

          {/* glucose hero */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
            {prediction && (
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontFamily: '"DM Mono", monospace', fontSize: 11, color: '#64748b', marginBottom: 2 }}>
                  30 min forecast
                </div>
                <div style={{ fontFamily: '"DM Mono", monospace', fontSize: 20, color: '#a78bfa', fontWeight: 500 }}>
                  {prediction.predicted_glucose} <span style={{ fontSize: 12, color: '#64748b' }}>mg/dL</span>
                </div>
              </div>
            )}
            <div style={{ width: 1, height: 44, background: 'rgba(255,255,255,0.07)' }} />
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontFamily: '"DM Mono", monospace', fontSize: 11, color: '#64748b', marginBottom: 2 }}>
                current · {getTrendLabel(trend)}
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{
                  fontFamily: '"DM Mono", monospace', fontSize: 52,
                  fontWeight: 300, color: glucoseColor, lineHeight: 1, letterSpacing: '-0.04em'
                }}>{current ?? '—'}</span>
                <div>
                  <div style={{ fontFamily: '"DM Mono", monospace', fontSize: 11, color: '#64748b' }}>mg/dL</div>
                  <div style={{ fontFamily: '"DM Mono", monospace', fontSize: 20, color: glucoseColor }}>{trend}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* main two-column layout */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 380px',
          gap: 24, padding: '28px 40px',
          maxWidth: 1400, margin: '0 auto'
        }}>

          {/* LEFT */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* chart — tall */}
            <div style={{
              background: '#0c0c17',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 16, padding: '24px 20px 16px 8px',
              flex: 1
            }}>
              <div style={{
                display: 'flex', justifyContent: 'space-between',
                alignItems: 'center', padding: '0 16px 20px'
              }}>
                <div style={{ fontFamily: '"DM Mono", monospace', fontSize: 11, color: '#64748b', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                  glucose · 2 hour window + 30 min forecast
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 20, height: 2, background: '#3b82f6', borderRadius: 1 }} />
                    <span style={{ fontFamily: '"DM Mono", monospace', fontSize: 11, color: '#94a3b8' }}>actual</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 20, height: 0, borderTop: '2px dashed #a78bfa' }} />
                    <span style={{ fontFamily: '"DM Mono", monospace', fontSize: 11, color: '#94a3b8' }}>forecast</span>
                  </div>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={chartData} margin={{ top: 4, right: 16, bottom: 0, left: -8 }}>
                  <defs>
                    <linearGradient id="glucGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="time"
                    tick={{ fill: '#64748b', fontSize: 11, fontFamily: 'DM Mono' }}
                    interval="preserveStartEnd" axisLine={false} tickLine={false} />
                  <YAxis
                  domain={([dataMin, dataMax]: number[]) => [
                    Math.max(40, dataMin - 25),
                   Math.min(400, dataMax + 40)
                  ]}
                  tick={{ fill: '#64748b', fontSize: 11, fontFamily: 'DM Mono' }}
                  axisLine={false} tickLine={false}
                  tickFormatter={(v) => `${v}`}
                />
                  <Tooltip content={<GlucoseTooltip />} />
                  <ReferenceLine y={70} stroke="#f8717140" strokeDasharray="4 4"
  label={{ value: 'hypo 70', fill: '#f87171', fontSize: 10, 
           fontFamily: 'DM Mono', position: 'insideRight' }} />
<ReferenceLine y={180} stroke="#fbbf2440" strokeDasharray="4 4"
  label={{ value: 'hyper 180', fill: '#fbbf24', fontSize: 10, 
           fontFamily: 'DM Mono', position: 'insideRight' }} />
                  {/* actual glucose area */}
                  <Area type="monotone" dataKey="actual" stroke="#3b82f6" strokeWidth={2}
                    fill="url(#glucGrad)" dot={false} connectNulls={false} name="actual" />
                  {/* bridge + forecast as dashed line */}
                  <Line type="monotone" dataKey="bridge" stroke="#a78bfa" strokeWidth={2}
                    strokeDasharray="6 4" dot={false} connectNulls={true} name="bridge"
                    legendType="none" />
                  {/* forecast dot */}
                  <Line type="monotone" dataKey="forecast" stroke="#a78bfa" strokeWidth={0}
                    dot={{ fill: '#a78bfa', r: 6, strokeWidth: 2, stroke: '#080810' }}
                    connectNulls={false} name="forecast" legendType="none" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* stats row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
              {[
                { label: 'time in range', value: `${tirPct}%`, color: '#34d399', sub: 'target ≥ 70%' },
                { label: 'mean glucose', value: `${meanGlc}`, color: '#60a5fa', sub: 'mg/dL · 2hr window' },
                { label: 'hypo readings', value: String(hypoCount), color: '#f87171', sub: `${hyperCount} hyper readings` },
              ].map(s => (
                <div key={s.label} style={{
                  background: '#0c0c17', border: '1px solid rgba(255,255,255,0.06)',
                  borderRadius: 12, padding: '18px 20px'
                }}>
                  <div style={{ fontFamily: '"Syne", sans-serif', fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10 }}>
                    {s.label}
                  </div>
                  <div style={{ fontFamily: '"DM Mono", monospace', fontSize: 34, fontWeight: 300, color: s.color, lineHeight: 1 }}>
                    {s.value}
                  </div>
                  <div style={{ fontFamily: '"DM Mono", monospace', fontSize: 11, color: '#64748b', marginTop: 8 }}>
                    {s.sub}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* RIGHT */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* today's stats */}
            <div style={{
              background: '#0c0c17', border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 16, padding: '20px 24px'
            }}>
              <div style={{ fontFamily: '"Syne", sans-serif', fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 16 }}>
                today at a glance
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {[
                  { label: 'meals logged', value: String(mealsToday), color: '#fb923c', icon: '⬡' },
                  { label: 'activities', value: String(activitiesLogged), color: '#34d399', icon: '◎' },
                  { label: 'hypos today', value: String(Math.max(0, hypoCount)), color: '#f87171', icon: '↓' },
                  { label: 'alert level', value: prediction?.alert_level ?? '—', color: prediction?.alert_level === 'CRITICAL' ? '#f87171' : prediction?.alert_level === 'WARNING' ? '#fbbf24' : '#34d399', icon: '◈' },
                ].map(item => (
                  <div key={item.label} style={{
                    background: 'rgba(255,255,255,0.02)',
                    border: '1px solid rgba(255,255,255,0.05)',
                    borderRadius: 10, padding: '14px'
                  }}>
                    <div style={{ fontFamily: '"DM Mono", monospace', fontSize: 11, color: '#64748b', marginBottom: 6 }}>
                      {item.icon} {item.label}
                    </div>
                    <div style={{ fontFamily: '"DM Mono", monospace', fontSize: 22, color: item.color, fontWeight: 400 }}>
                      {item.value}
                    </div>
                  </div>
                ))}
              </div>

              {/* IOB */}
              {prediction?.iob && prediction.iob.iob_units > 0 && (
                <div style={{
                  marginTop: 12, padding: '12px 14px',
                  background: 'rgba(139,92,246,0.07)',
                  border: '1px solid rgba(139,92,246,0.18)',
                  borderRadius: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                }}>
                  <div>
                    <div style={{ fontFamily: '"Syne", sans-serif', fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                      insulin on board
                    </div>
                    <div style={{ fontFamily: '"DM Mono", monospace', fontSize: 11, color: '#94a3b8', marginTop: 3 }}>
                      {prediction.iob.message}
                    </div>
                  </div>
                  <div style={{ fontFamily: '"DM Mono", monospace', fontSize: 28, color: '#a78bfa', fontWeight: 300 }}>
                    {prediction.iob.iob_units}U
                  </div>
                </div>
              )}

              {/* live insight */}
              {current && prediction && (
                <div style={{
                  marginTop: 12, padding: '12px 14px',
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.05)',
                  borderRadius: 10
                }}>
                  <div style={{ fontFamily: '"DM Mono", monospace', fontSize: 12, color: '#94a3b8', lineHeight: 1.7 }}>
                    <span style={{ color: glucoseColor }}>{current} mg/dL</span>
                    {' · '}{getTrendLabel(trend)}
                    {' · '}<span style={{ color: '#a78bfa' }}>{prediction.predicted_glucose} forecast</span>
                    {prediction.iob?.iob_units ? ` · ${prediction.iob.iob_units}U active` : ' · no active insulin'}
                  </div>
                </div>
              )}
            </div>

            {/* meal + activity panel */}
            <div style={{
              background: '#0c0c17', border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 16, padding: '24px', flex: 1
            }}>
              <div style={{ display: 'flex', gap: 6, marginBottom: 22 }}>
                {(['meal', 'activity'] as const).map(t => (
                  <button key={t} onClick={() => setActiveTab(t)} style={{
                    fontFamily: '"Syne", sans-serif', fontSize: 11, fontWeight: 700,
                    letterSpacing: '0.08em', textTransform: 'uppercase',
                    padding: '7px 20px', borderRadius: 100, border: 'none',
                    cursor: 'pointer',
                    background: activeTab === t ? 'rgba(139,92,246,0.2)' : 'transparent',
                    color: activeTab === t ? '#c4b5fd' : '#64748b'
                  }}>
                    {t === 'meal' ? '⬡ Meal' : '◎ Activity'}
                  </button>
                ))}
              </div>
              {activeTab === 'meal'
                ? <MealPanel onMealLogged={() => setMealsToday(m => m + 1)} />
                : <ActivityPanel onActivityLogged={() => setActivitiesLogged(a => a + 1)} />
              }
            </div>

            {/* refresh */}
            <button onClick={update} style={{
              width: '100%', background: 'transparent',
              border: '1px solid rgba(255,255,255,0.07)',
              borderRadius: 10, padding: '11px',
              fontFamily: '"DM Mono", monospace', fontSize: 12,
              color: '#475569', cursor: 'pointer', letterSpacing: '0.06em'
            }}>↺ refresh readings</button>
          </div>
        </div>
      </div>
    </>
  )
}