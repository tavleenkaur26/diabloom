'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import axios from 'axios'
import {
  AreaChart, Area, XAxis, YAxis, ReferenceLine,
  ResponsiveContainer, Tooltip
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

interface GlucosePoint { time: string; glucose: number | null; predicted: number | null }

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

function getZoneColor(g: number) {
  if (g < 70) return '#ef4444'
  if (g < 85) return '#f59e0b'
  if (g <= 180) return '#34d399'
  if (g <= 250) return '#f59e0b'
  return '#ef4444'
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
  return (
    <div style={{
      background: '#13131f', border: '1px solid rgba(139,92,246,0.25)',
      borderRadius: 8, padding: '8px 14px',
      fontFamily: '"DM Mono", monospace', fontSize: 12, color: '#94a3b8'
    }}>
      <div style={{ marginBottom: 4 }}>{label}</div>
      {payload.map((p: any) => p.value && (
        <div key={p.name} style={{ color: p.name === 'predicted' ? '#a78bfa' : '#60a5fa' }}>
          {p.name === 'predicted' ? 'forecast' : 'actual'}: <strong>{Math.round(p.value)}</strong> mg/dL
        </div>
      ))}
    </div>
  )
}

function MealPanel() {
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
    } finally { setLoading(false) }
  }

  const impactColor: Record<string, string> = {
    'low spike': '#34d399', 'moderate spike': '#f59e0b', 'high spike': '#ef4444'
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {(['text', 'photo'] as const).map(m => (
          <button key={m} onClick={() => setMode(m)} style={{
            fontFamily: '"DM Mono", monospace', fontSize: 11,
            padding: '5px 14px', borderRadius: 6, cursor: 'pointer',
            border: `1px solid ${mode === m ? 'rgba(139,92,246,0.5)' : 'rgba(255,255,255,0.08)'}`,
            background: mode === m ? 'rgba(139,92,246,0.12)' : 'transparent',
            color: mode === m ? '#a78bfa' : '#64748b'
          }}>{m === 'text' ? '/ text' : '◉ photo'}</button>
        ))}
      </div>

      {mode === 'text' ? (
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={desc} onChange={e => setDesc(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && analyseText()}
            placeholder="2 rotis, dal, rice, curd..."
            style={{
              flex: 1, background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 8, padding: '10px 14px',
              fontFamily: '"DM Mono", monospace', fontSize: 13,
              color: '#e2e8f0', outline: 'none'
            }} />
          <button onClick={analyseText} disabled={loading || !desc.trim()} style={{
            background: 'rgba(139,92,246,0.15)',
            border: '1px solid rgba(139,92,246,0.3)',
            borderRadius: 8, padding: '10px 20px',
            fontFamily: '"Syne", sans-serif', fontSize: 12,
            fontWeight: 600, color: '#a78bfa', cursor: 'pointer',
            opacity: loading || !desc.trim() ? 0.4 : 1
          }}>{loading ? '...' : 'analyse'}</button>
        </div>
      ) : (
        <div>
          <input ref={fileRef} type="file" accept="image/*" capture="environment"
            onChange={e => e.target.files?.[0] && analysePhoto(e.target.files[0])}
            style={{ display: 'none' }} />
          <button onClick={() => fileRef.current?.click()} disabled={loading} style={{
            width: '100%', background: 'rgba(255,255,255,0.02)',
            border: '1px dashed rgba(139,92,246,0.3)', borderRadius: 8,
            padding: '20px', fontFamily: '"DM Mono", monospace',
            fontSize: 12, color: '#475569', cursor: 'pointer'
          }}>{loading ? 'analysing...' : '◉ click to upload meal photo'}</button>
        </div>
      )}

      {nutrition && (
        <div style={{
          marginTop: 16, background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 10, padding: '16px 18px'
        }}>
          {nutrition.identified_foods && (
            <div style={{ fontFamily: '"DM Mono", monospace', fontSize: 11, color: '#475569', marginBottom: 10 }}>
              detected — {nutrition.identified_foods.join(', ')}
            </div>
          )}
          <div style={{
            fontFamily: '"Syne", sans-serif', fontSize: 15, fontWeight: 600,
            color: impactColor[nutrition.estimated_impact] || '#e2e8f0', marginBottom: 16
          }}>
            {nutrition.estimated_impact} · peaks ~{nutrition.peak_time_mins} min
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 14 }}>
            {[
              { label: 'carbs', value: `${nutrition.carbs_g}g`, color: '#fb923c' },
              { label: 'fat', value: `${nutrition.fat_g}g`, color: '#facc15' },
              { label: 'protein', value: `${nutrition.protein_g}g`, color: '#60a5fa' },
              { label: 'GI', value: String(nutrition.gi_score), color: '#a78bfa' },
            ].map(item => (
              <div key={item.label} style={{ textAlign: 'center' }}>
                <div style={{ fontFamily: '"DM Mono", monospace', fontSize: 20, fontWeight: 500, color: item.color }}>{item.value}</div>
                <div style={{ fontFamily: '"Syne", sans-serif', fontSize: 10, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: 2 }}>{item.label}</div>
              </div>
            ))}
          </div>
          <div style={{ fontFamily: '"DM Mono", monospace', fontSize: 11, color: '#64748b', lineHeight: 1.6 }}>
            {nutrition.notes}
          </div>
        </div>
      )}
    </div>
  )
}

function ActivityPanel() {
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
    } finally { setLoading(false) }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        {['exercise', 'walk', 'sport', 'other'].map(a => (
          <button key={a} onClick={() => setActivity(a)} style={{
            fontFamily: '"DM Mono", monospace', fontSize: 11,
            padding: '5px 14px', borderRadius: 6, cursor: 'pointer',
            border: `1px solid ${activity === a ? 'rgba(139,92,246,0.5)' : 'rgba(255,255,255,0.08)'}`,
            background: activity === a ? 'rgba(139,92,246,0.12)' : 'transparent',
            color: activity === a ? '#a78bfa' : '#64748b'
          }}>{a}</button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {[
          { key: 'light', color: '#34d399' },
          { key: 'moderate', color: '#f59e0b' },
          { key: 'intense', color: '#ef4444' }
        ].map(({ key, color }) => (
          <button key={key} onClick={() => setIntensity(key as any)} style={{
            flex: 1, fontFamily: '"Syne", sans-serif', fontSize: 11,
            fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em',
            padding: '9px', borderRadius: 8, cursor: 'pointer', border: 'none',
            background: intensity === key ? `${color}18` : 'rgba(255,255,255,0.03)',
            color: intensity === key ? color : '#475569',
            outline: intensity === key ? `1px solid ${color}44` : '1px solid rgba(255,255,255,0.06)'
          }}>{key}</button>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <span style={{ fontFamily: '"DM Mono", monospace', fontSize: 11, color: '#64748b', minWidth: 56 }}>duration</span>
        <input type="range" min={5} max={120} step={5} value={duration}
          onChange={e => setDuration(Number(e.target.value))}
          style={{ flex: 1, accentColor: '#8b5cf6' }} />
        <span style={{ fontFamily: '"DM Mono", monospace', fontSize: 13, color: '#a78bfa', minWidth: 52, textAlign: 'right' }}>
          {duration} min
        </span>
      </div>

      <button onClick={logActivity} disabled={!intensity || loading} style={{
        width: '100%', background: 'rgba(139,92,246,0.1)',
        border: '1px solid rgba(139,92,246,0.25)', borderRadius: 8,
        padding: '10px', fontFamily: '"Syne", sans-serif',
        fontSize: 12, fontWeight: 600, color: '#a78bfa',
        cursor: 'pointer', opacity: !intensity || loading ? 0.4 : 1
      }}>{loading ? 'logging...' : 'log activity'}</button>

      {result && (
        <div style={{
          marginTop: 14, padding: '12px 16px',
          background: 'rgba(245,158,11,0.06)',
          border: '1px solid rgba(245,158,11,0.18)', borderRadius: 8
        }}>
          <div style={{ fontFamily: '"Syne", sans-serif', fontSize: 13, color: '#f59e0b', fontWeight: 600 }}>
            ◈ {result.risk_window}
          </div>
          <div style={{ fontFamily: '"DM Mono", monospace', fontSize: 11, color: '#64748b', marginTop: 4 }}>
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

  const current = readings.length ? Math.round(readings[readings.length - 1]) : null
  const trend = getTrendArrow(readings)
  const glucoseColor = current ? getZoneColor(current) : '#60a5fa'

  const tirPct = readings.length ? Math.round(readings.filter(r => r >= 70 && r <= 180).length / readings.length * 100) : 0
  const meanGlc = readings.length ? Math.round(readings.reduce((a, b) => a + b, 0) / readings.length) : 0
  const hypoPct = readings.length ? Math.round(readings.filter(r => r < 70).length / readings.length * 100) : 0

  const fetchPrediction = useCallback(async (r: number[]) => {
    setLoading(true)
    try {
      const res = await axios.post('http://127.0.0.1:8000/predict/fast', { readings: r, patient_id: 'demo' })
      setPrediction(res.data)
    } catch { } finally { setLoading(false) }
  }, [])

  const update = useCallback(async () => {
    const { readings: r } = await fetchRealReadings()
    setReadings(r)
    const now = new Date()
    const chart: GlucosePoint[] = r.map((g, i) => ({
      time: new Date(now.getTime() - (23 - i) * 5 * 60000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      glucose: Math.round(g), predicted: null
    }))
    if (prediction) chart.push({
      time: new Date(now.getTime() + 30 * 60000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      glucose: null, predicted: prediction.predicted_glucose
    })
    setChartData(chart)
    setLastUpdate(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
    fetchPrediction(r)
  }, [prediction, fetchPrediction])

  useEffect(() => { update() }, [])
  useEffect(() => { const id = setInterval(update, 30000); return () => clearInterval(id) }, [update])

  const alertColors = {
    OK: { bg: 'transparent', border: 'transparent', text: 'transparent' },
    WARNING: { bg: 'rgba(245,158,11,0.07)', border: 'rgba(245,158,11,0.3)', text: '#f59e0b' },
    CRITICAL: { bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.35)', text: '#ef4444' },
  }
  const ac = prediction ? alertColors[prediction.alert_level] : alertColors.OK

  const trendLabel = trend === '→' ? 'stable' : (trend === '↓' || trend === '↘') ? 'dropping' : 'rising'

  return (
    <>
      <style>{fontLink}</style>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #080810; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.2} }
        input::placeholder { color: #334155; }
      `}</style>

      <div style={{ minHeight: '100vh', background: '#080810', color: '#e2e8f0', fontFamily: '"Syne", sans-serif' }}>

        {/* alert banner */}
        {prediction && prediction.alert_level !== 'OK' && (
          <div style={{
            background: ac.bg, borderBottom: `1px solid ${ac.border}`,
            padding: '11px 40px', display: 'flex', alignItems: 'center', gap: 12
          }}>
            <span style={{
              display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
              background: ac.text, flexShrink: 0, animation: 'pulse 1.4s infinite'
            }} />
            <span style={{ fontFamily: '"DM Mono", monospace', fontSize: 13, color: ac.text }}>
              {prediction.message}
            </span>
            {prediction.explanation && (
              <span style={{ fontFamily: '"DM Mono", monospace', fontSize: 12, color: '#475569' }}>
                — {prediction.explanation}
              </span>
            )}
          </div>
        )}

        {/* top nav bar */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '20px 40px',
          borderBottom: '1px solid rgba(255,255,255,0.04)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
            <div>
              <span style={{ fontFamily: '"Syne", sans-serif', fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', color: '#e2e8f0' }}>
                diab<span style={{ color: '#8b5cf6' }}>loom</span>
              </span>
            </div>
            <div style={{ fontFamily: '"DM Mono", monospace', fontSize: 10, color: '#334155', letterSpacing: '0.1em' }}>
              T1D COPILOT · {loading ? 'syncing...' : `updated ${lastUpdate}`}
            </div>
          </div>

          {/* glucose hero — top right */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            {prediction && (
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontFamily: '"DM Mono", monospace', fontSize: 11, color: '#334155' }}>
                  30min forecast
                </div>
                <div style={{ fontFamily: '"DM Mono", monospace', fontSize: 18, color: '#7c3aed' }}>
                  {prediction.predicted_glucose} mg/dL
                </div>
              </div>
            )}
            <div style={{
              width: 1, height: 40,
              background: 'rgba(255,255,255,0.06)'
            }} />
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontFamily: '"DM Mono", monospace', fontSize: 11, color: '#334155', marginBottom: 2 }}>
                current
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{
                  fontFamily: '"DM Mono", monospace',
                  fontSize: 48, fontWeight: 300,
                  color: glucoseColor, lineHeight: 1,
                  letterSpacing: '-0.04em'
                }}>{current ?? '—'}</span>
                <div>
                  <div style={{ fontFamily: '"DM Mono", monospace', fontSize: 10, color: '#475569' }}>mg/dL</div>
                  <div style={{ fontFamily: '"DM Mono", monospace', fontSize: 18, color: glucoseColor }}>{trend}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* main content — two column */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 360px',
          gap: 24,
          padding: '28px 40px',
          maxWidth: 1280,
          margin: '0 auto'
        }}>

          {/* LEFT COLUMN */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* chart */}
            <div style={{
              background: '#0c0c17',
              border: '1px solid rgba(255,255,255,0.05)',
              borderRadius: 16,
              padding: '24px 16px 16px 8px'
            }}>
              <div style={{
                fontFamily: '"DM Mono", monospace', fontSize: 10,
                color: '#334155', letterSpacing: '0.12em',
                textTransform: 'uppercase', padding: '0 16px 16px'
              }}>
                glucose · 2hr window + 30min forecast
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={chartData} margin={{ top: 4, right: 16, bottom: 0, left: -16 }}>
                  <defs>
                    <linearGradient id="glucGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.12} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="predGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.12} />
                      <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="time"
                    tick={{ fill: '#334155', fontSize: 10, fontFamily: 'DM Mono' }}
                    interval="preserveStartEnd" axisLine={false} tickLine={false} />
                  <YAxis domain={[50, 280]}
                    tick={{ fill: '#334155', fontSize: 10, fontFamily: 'DM Mono' }}
                    axisLine={false} tickLine={false} />
                  <Tooltip content={<GlucoseTooltip />} />
                  <ReferenceLine y={70} stroke="#ef444428" strokeDasharray="3 4" />
                  <ReferenceLine y={180} stroke="#f59e0b28" strokeDasharray="3 4" />
                  <Area type="monotone" dataKey="glucose" stroke="#3b82f6" strokeWidth={2}
                    fill="url(#glucGrad)" dot={false} connectNulls={false} name="actual" />
                  <Area type="monotone" dataKey="predicted" stroke="#8b5cf6" strokeWidth={2}
                    strokeDasharray="5 3" fill="url(#predGrad)"
                    dot={{ fill: '#8b5cf6', r: 5, strokeWidth: 0 }}
                    connectNulls={false} name="predicted" />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* stats row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
              {[
                { label: 'time in range', value: `${tirPct}%`, color: '#34d399', sub: 'target ≥70%' },
                { label: 'mean glucose', value: String(meanGlc), color: '#60a5fa', sub: 'mg/dL · last 2hrs' },
                { label: 'hypo time', value: `${hypoPct}%`, color: '#ef4444', sub: 'readings <70 mg/dL' },
              ].map(s => (
                <div key={s.label} style={{
                  background: '#0c0c17',
                  border: '1px solid rgba(255,255,255,0.05)',
                  borderRadius: 12, padding: '18px 20px'
                }}>
                  <div style={{ fontFamily: '"Syne", sans-serif', fontSize: 10, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
                    {s.label}
                  </div>
                  <div style={{ fontFamily: '"DM Mono", monospace', fontSize: 32, fontWeight: 300, color: s.color, lineHeight: 1 }}>
                    {s.value}
                  </div>
                  <div style={{ fontFamily: '"DM Mono", monospace', fontSize: 10, color: '#334155', marginTop: 6 }}>
                    {s.sub}
                  </div>
                </div>
              ))}
            </div>

            {/* insight + IOB row */}
            <div style={{ display: 'grid', gridTemplateColumns: prediction?.iob?.iob_units ? '1fr 180px' : '1fr', gap: 12 }}>
              {/* insight */}
              <div style={{
                background: '#0c0c17',
                border: '1px solid rgba(255,255,255,0.05)',
                borderRadius: 12, padding: '18px 20px',
                display: 'flex', flexDirection: 'column', justifyContent: 'center'
              }}>
                <div style={{ fontFamily: '"Syne", sans-serif', fontSize: 10, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
                  live insight
                </div>
                <div style={{ fontFamily: '"DM Mono", monospace', fontSize: 13, color: '#64748b', lineHeight: 1.7 }}>
                  {current && prediction ? (
                    <>
                      <span style={{ color: glucoseColor }}>{current} mg/dL</span>
                      {' '}&middot; {trendLabel}
                      {' '}&middot; <span style={{ color: '#a78bfa' }}>{prediction.predicted_glucose} predicted</span>
                      {' '}&middot; {prediction.iob?.iob_units ? `${prediction.iob.iob_units}U active insulin` : 'no active insulin'}
                    </>
                  ) : 'Loading glucose data...'}
                </div>
              </div>

              {/* IOB card */}
              {prediction?.iob && prediction.iob.iob_units > 0 && (
                <div style={{
                  background: 'rgba(139,92,246,0.05)',
                  border: '1px solid rgba(139,92,246,0.15)',
                  borderRadius: 12, padding: '18px 20px'
                }}>
                  <div style={{ fontFamily: '"Syne", sans-serif', fontSize: 10, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
                    insulin on board
                  </div>
                  <div style={{ fontFamily: '"DM Mono", monospace', fontSize: 32, fontWeight: 300, color: '#a78bfa', lineHeight: 1 }}>
                    {prediction.iob.iob_units}U
                  </div>
                  <div style={{ fontFamily: '"DM Mono", monospace', fontSize: 10, color: '#475569', marginTop: 6 }}>
                    {prediction.iob.risk_level} risk
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT COLUMN */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* action panel */}
            <div style={{
              background: '#0c0c17',
              border: '1px solid rgba(255,255,255,0.05)',
              borderRadius: 16, padding: '24px'
            }}>
              {/* tabs */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 22 }}>
                {(['meal', 'activity'] as const).map(t => (
                  <button key={t} onClick={() => setActiveTab(t)} style={{
                    fontFamily: '"Syne", sans-serif', fontSize: 11, fontWeight: 600,
                    letterSpacing: '0.08em', textTransform: 'uppercase',
                    padding: '6px 18px', borderRadius: 100, border: 'none',
                    cursor: 'pointer',
                    background: activeTab === t ? 'rgba(139,92,246,0.18)' : 'transparent',
                    color: activeTab === t ? '#a78bfa' : '#475569',
                    transition: 'all 0.15s'
                  }}>
                    {t === 'meal' ? '⬡ Meal' : '◎ Activity'}
                  </button>
                ))}
              </div>

              {activeTab === 'meal' ? <MealPanel /> : <ActivityPanel />}
            </div>

            {/* model info card */}
            <div style={{
              background: '#0c0c17',
              border: '1px solid rgba(255,255,255,0.05)',
              borderRadius: 16, padding: '20px 24px'
            }}>
              <div style={{ fontFamily: '"Syne", sans-serif', fontSize: 10, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 14 }}>
                model info
              </div>
              {[
                { label: 'architecture', value: 'LSTM · 2 layers · 64 hidden' },
                { label: 'trained on', value: 'D1NAMO · 9 T1D patients' },
                { label: 'horizon', value: '30 min ahead' },
                { label: 'accuracy', value: '94.4% hypo direction' },
                { label: 'MAE', value: '18.5 mg/dL' },
                { label: 'explainability', value: 'SHAP values' },
              ].map(item => (
                <div key={item.label} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '7px 0',
                  borderBottom: '1px solid rgba(255,255,255,0.03)'
                }}>
                  <span style={{ fontFamily: '"DM Mono", monospace', fontSize: 11, color: '#334155' }}>
                    {item.label}
                  </span>
                  <span style={{ fontFamily: '"DM Mono", monospace', fontSize: 11, color: '#64748b' }}>
                    {item.value}
                  </span>
                </div>
              ))}
            </div>

            {/* refresh */}
            <button onClick={update} style={{
              width: '100%', background: 'transparent',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 10, padding: '10px',
              fontFamily: '"DM Mono", monospace',
              fontSize: 11, color: '#334155',
              cursor: 'pointer', letterSpacing: '0.06em'
            }}>↺ refresh readings</button>
          </div>
        </div>
      </div>
    </>
  )
}