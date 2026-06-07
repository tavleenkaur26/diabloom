'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import axios from 'axios'
import {
  LineChart, Line, XAxis, YAxis, ReferenceLine,
  ResponsiveContainer, Tooltip, Area, AreaChart
} from 'recharts'

// ── Google Fonts ─────────────────────────────────────
const fontLink = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@400;500;600;700&display=swap');
`

// ── Types ─────────────────────────────────────────────
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
  glucose: number | null
  predicted: number | null
}

interface NutritionData {
  identified_foods?: string[]
  carbs_g: number
  fat_g: number
  protein_g: number
  gi_score: number
  estimated_impact: string
  peak_time_mins: number
  notes: string
}

// ── Helpers ───────────────────────────────────────────
function getTrendArrow(readings: number[]): string {
  if (readings.length < 4) return '→'
  const recent = readings.slice(-4)
  const delta = recent[3] - recent[0]
  if (delta > 8) return '↑'
  if (delta > 3) return '↗'
  if (delta < -8) return '↓'
  if (delta < -3) return '↘'
  return '→'
}

function getGlucoseZone(glucose: number): 'hypo' | 'low' | 'ok' | 'high' | 'hyper' {
  if (glucose < 70) return 'hypo'
  if (glucose < 80) return 'low'
  if (glucose <= 180) return 'ok'
  if (glucose <= 250) return 'high'
  return 'hyper'
}

async function fetchRealReadings(): Promise<{ readings: number[]; timestamps: string[] }> {
  try {
    const res = await axios.get('http://127.0.0.1:8000/mydata/latest')
    return { readings: res.data.readings, timestamps: res.data.timestamps }
  } catch {
    const readings = Array.from({ length: 24 }, (_, i) =>
      Math.max(55, 130 - i * 1.5 + (Math.random() - 0.5) * 12)
    )
    return { readings, timestamps: [] }
  }
}

// ── Custom Tooltip ────────────────────────────────────
function GlucoseTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: '#12121a',
      border: '1px solid rgba(139,92,246,0.3)',
      borderRadius: 8,
      padding: '8px 12px',
      fontFamily: '"DM Mono", monospace',
      fontSize: 12,
      color: '#e2e8f0'
    }}>
      <div style={{ color: '#94a3b8', marginBottom: 4 }}>{label}</div>
      {payload.map((p: any) => p.value && (
        <div key={p.name} style={{ color: p.name === 'predicted' ? '#a78bfa' : '#60a5fa' }}>
          {p.name === 'predicted' ? 'pred' : 'actual'}: {Math.round(p.value)} mg/dL
        </div>
      ))}
    </div>
  )
}

// ── Meal + Activity Panel ─────────────────────────────
function ActionPanel() {
  const [tab, setTab] = useState<'meal' | 'activity'>('meal')
  const [mealMode, setMealMode] = useState<'text' | 'photo'>('text')
  const [description, setDescription] = useState('')
  const [nutrition, setNutrition] = useState<NutritionData | null>(null)
  const [mealLoading, setMealLoading] = useState(false)
  const [activity, setActivity] = useState('exercise')
  const [intensity, setIntensity] = useState<'light' | 'moderate' | 'intense' | ''>('')
  const [duration, setDuration] = useState(30)
  const [activityResult, setActivityResult] = useState<any>(null)
  const [activityLoading, setActivityLoading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const analyseMealText = async () => {
    if (!description.trim()) return
    setMealLoading(true)
    setNutrition(null)
    try {
      const res = await axios.post('http://127.0.0.1:8000/meal/analyse', {
        description, patient_id: '550e8400-e29b-41d4-a716-446655440000'
      })
      setNutrition(res.data.nutrition)
    } finally { setMealLoading(false) }
  }

  const analyseMealPhoto = async (file: File) => {
    setMealLoading(true)
    setNutrition(null)
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve((reader.result as string).split(',')[1])
        reader.onerror = reject
        reader.readAsDataURL(file)
      })
      const res = await axios.post('http://127.0.0.1:8000/meal/analyse-photo', {
        image_base64: base64, patient_id: '550e8400-e29b-41d4-a716-446655440000'
      })
      setNutrition(res.data.nutrition)
    } finally { setMealLoading(false) }
  }

  const logActivity = async () => {
    if (!intensity) return
    setActivityLoading(true)
    try {
      const res = await axios.post('http://127.0.0.1:8000/activity/log', {
        activity_type: activity, intensity, duration_mins: duration,
        patient_id: '550e8400-e29b-41d4-a716-446655440000'
      })
      setActivityResult(res.data)
    } finally { setActivityLoading(false) }
  }

  const impactColor: Record<string, string> = {
    'low spike': '#22c55e', 'moderate spike': '#f59e0b', 'high spike': '#ef4444'
  }

  return (
    <div style={{
      background: '#0f0f18',
      border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: 16,
      padding: '20px 24px',
      marginTop: 16
    }}>
      {/* tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {(['meal', 'activity'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            fontFamily: '"Syne", sans-serif',
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            padding: '6px 16px',
            borderRadius: 100,
            border: 'none',
            cursor: 'pointer',
            background: tab === t ? 'rgba(139,92,246,0.2)' : 'transparent',
            color: tab === t ? '#a78bfa' : '#475569',
            transition: 'all 0.15s'
          }}>
            {t === 'meal' ? '⬡ Meal' : '◎ Activity'}
          </button>
        ))}
      </div>

      {/* meal panel */}
      {tab === 'meal' && (
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {(['text', 'photo'] as const).map(m => (
              <button key={m} onClick={() => setMealMode(m)} style={{
                fontFamily: '"DM Mono", monospace',
                fontSize: 11,
                padding: '4px 12px',
                borderRadius: 6,
                border: `1px solid ${mealMode === m ? 'rgba(139,92,246,0.5)' : 'rgba(255,255,255,0.08)'}`,
                background: mealMode === m ? 'rgba(139,92,246,0.1)' : 'transparent',
                color: mealMode === m ? '#a78bfa' : '#475569',
                cursor: 'pointer'
              }}>
                {m === 'text' ? '/ text' : '◉ photo'}
              </button>
            ))}
          </div>

          {mealMode === 'text' ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={description}
                onChange={e => setDescription(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && analyseMealText()}
                placeholder="2 rotis, dal, rice, curd..."
                style={{
                  flex: 1,
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 8,
                  padding: '10px 14px',
                  fontFamily: '"DM Mono", monospace',
                  fontSize: 13,
                  color: '#e2e8f0',
                  outline: 'none'
                }}
              />
              <button onClick={analyseMealText} disabled={mealLoading || !description.trim()} style={{
                background: 'rgba(139,92,246,0.15)',
                border: '1px solid rgba(139,92,246,0.3)',
                borderRadius: 8,
                padding: '10px 16px',
                fontFamily: '"Syne", sans-serif',
                fontSize: 12,
                fontWeight: 600,
                color: '#a78bfa',
                cursor: 'pointer',
                opacity: mealLoading || !description.trim() ? 0.4 : 1
              }}>
                {mealLoading ? '...' : 'analyse'}
              </button>
            </div>
          ) : (
            <div>
              <input ref={fileRef} type="file" accept="image/*" capture="environment"
                onChange={e => e.target.files?.[0] && analyseMealPhoto(e.target.files[0])}
                style={{ display: 'none' }} />
              <button onClick={() => fileRef.current?.click()} disabled={mealLoading} style={{
                width: '100%',
                background: 'rgba(255,255,255,0.02)',
                border: '1px dashed rgba(139,92,246,0.3)',
                borderRadius: 8,
                padding: '24px',
                fontFamily: '"DM Mono", monospace',
                fontSize: 12,
                color: '#475569',
                cursor: 'pointer'
              }}>
                {mealLoading ? 'analysing...' : '◉ tap to photograph meal'}
              </button>
            </div>
          )}

          {nutrition && (
            <div style={{
              marginTop: 16,
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 10,
              padding: '16px'
            }}>
              {nutrition.identified_foods && (
                <div style={{
                  fontFamily: '"DM Mono", monospace', fontSize: 11,
                  color: '#475569', marginBottom: 10
                }}>
                  identified — {nutrition.identified_foods.join(', ')}
                </div>
              )}
              <div style={{
                fontFamily: '"Syne", sans-serif', fontSize: 14, fontWeight: 600,
                color: impactColor[nutrition.estimated_impact] || '#e2e8f0',
                marginBottom: 14
              }}>
                {nutrition.estimated_impact} · peaks ~{nutrition.peak_time_mins}min
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginBottom: 12 }}>
                {[
                  { label: 'carbs', value: `${nutrition.carbs_g}g`, color: '#fb923c' },
                  { label: 'fat', value: `${nutrition.fat_g}g`, color: '#facc15' },
                  { label: 'protein', value: `${nutrition.protein_g}g`, color: '#60a5fa' },
                  { label: 'gi', value: nutrition.gi_score, color: '#a78bfa' },
                ].map(item => (
                  <div key={item.label} style={{ textAlign: 'center' }}>
                    <div style={{
                      fontFamily: '"DM Mono", monospace',
                      fontSize: 18, fontWeight: 500, color: item.color
                    }}>{item.value}</div>
                    <div style={{
                      fontFamily: '"Syne", sans-serif',
                      fontSize: 10, color: '#475569',
                      textTransform: 'uppercase', letterSpacing: '0.1em'
                    }}>{item.label}</div>
                  </div>
                ))}
              </div>
              <div style={{
                fontFamily: '"DM Mono", monospace', fontSize: 11,
                color: '#475569', fontStyle: 'italic', lineHeight: 1.5
              }}>{nutrition.notes}</div>
            </div>
          )}
        </div>
      )}

      {/* activity panel */}
      {tab === 'activity' && (
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            {['exercise', 'walk', 'sport', 'other'].map(a => (
              <button key={a} onClick={() => setActivity(a)} style={{
                fontFamily: '"DM Mono", monospace', fontSize: 11,
                padding: '4px 12px', borderRadius: 6,
                border: `1px solid ${activity === a ? 'rgba(139,92,246,0.5)' : 'rgba(255,255,255,0.08)'}`,
                background: activity === a ? 'rgba(139,92,246,0.1)' : 'transparent',
                color: activity === a ? '#a78bfa' : '#475569', cursor: 'pointer'
              }}>{a}</button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {[
              { key: 'light', color: '#22c55e' },
              { key: 'moderate', color: '#f59e0b' },
              { key: 'intense', color: '#ef4444' }
            ].map(({ key, color }) => (
              <button key={key} onClick={() => setIntensity(key as any)} style={{
                flex: 1, fontFamily: '"Syne", sans-serif', fontSize: 11, fontWeight: 600,
                textTransform: 'uppercase', letterSpacing: '0.06em',
                padding: '8px', borderRadius: 8, border: 'none', cursor: 'pointer',
                background: intensity === key ? `${color}22` : 'rgba(255,255,255,0.03)',
                color: intensity === key ? color : '#475569',
                outline: intensity === key ? `1px solid ${color}44` : '1px solid rgba(255,255,255,0.06)'
              }}>{key}</button>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <span style={{ fontFamily: '"DM Mono", monospace', fontSize: 11, color: '#475569' }}>duration</span>
            <input type="range" min={5} max={120} step={5} value={duration}
              onChange={e => setDuration(Number(e.target.value))}
              style={{ flex: 1, accentColor: '#8b5cf6' }} />
            <span style={{ fontFamily: '"DM Mono", monospace', fontSize: 12, color: '#a78bfa', minWidth: 48 }}>
              {duration}min
            </span>
          </div>

          <button onClick={logActivity} disabled={!intensity || activityLoading} style={{
            width: '100%', background: 'rgba(139,92,246,0.1)',
            border: '1px solid rgba(139,92,246,0.25)', borderRadius: 8,
            padding: '10px', fontFamily: '"Syne", sans-serif', fontSize: 12,
            fontWeight: 600, color: '#a78bfa', cursor: 'pointer',
            opacity: !intensity || activityLoading ? 0.4 : 1
          }}>
            {activityLoading ? 'logging...' : 'log activity'}
          </button>

          {activityResult && (
            <div style={{
              marginTop: 12, padding: '12px 14px',
              background: 'rgba(245,158,11,0.06)',
              border: '1px solid rgba(245,158,11,0.2)',
              borderRadius: 8
            }}>
              <div style={{ fontFamily: '"Syne", sans-serif', fontSize: 13, color: '#f59e0b', fontWeight: 600 }}>
                ◈ {activityResult.risk_window}
              </div>
              <div style={{ fontFamily: '"DM Mono", monospace', fontSize: 11, color: '#475569', marginTop: 4 }}>
                {activityResult.advice}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main Dashboard ────────────────────────────────────
export default function Dashboard() {
  const [readings,   setReadings]   = useState<number[]>([])
  const [chartData,  setChartData]  = useState<GlucosePoint[]>([])
  const [prediction, setPrediction] = useState<Prediction | null>(null)
  const [loading,    setLoading]    = useState(false)
  const [lastUpdate, setLastUpdate] = useState('')

  const currentGlucose = readings.length > 0 ? Math.round(readings[readings.length - 1]) : null
  const trend = getTrendArrow(readings)
  const zone  = currentGlucose ? getGlucoseZone(currentGlucose) : 'ok'

  const zoneColors: Record<string, string> = {
    hypo: '#ef4444', low: '#f59e0b', ok: '#60a5fa', high: '#f59e0b', hyper: '#ef4444'
  }
  const glucoseColor = zoneColors[zone]

  const alertColors: Record<string, { bg: string; border: string; text: string }> = {
    OK:       { bg: 'transparent', border: 'transparent', text: 'transparent' },
    WARNING:  { bg: 'rgba(245,158,11,0.06)', border: 'rgba(245,158,11,0.25)', text: '#f59e0b' },
    CRITICAL: { bg: 'rgba(239,68,68,0.08)',  border: 'rgba(239,68,68,0.35)',  text: '#ef4444' },
  }

  const fetchPrediction = useCallback(async (currentReadings: number[]) => {
    setLoading(true)
    try {
      const res = await axios.post('http://127.0.0.1:8000/predict/fast', {
        readings: currentReadings, patient_id: 'demo'
      })
      setPrediction(res.data)
    } catch { } finally { setLoading(false) }
  }, [])

  const updateReadings = useCallback(async () => {
    const { readings: newReadings, timestamps } = await fetchRealReadings()
    setReadings(newReadings)

    const now = new Date()
    const chart: GlucosePoint[] = newReadings.map((glucose, i) => {
      const t = new Date(now.getTime() - (23 - i) * 5 * 60000)
      return {
        time: t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        glucose: Math.round(glucose),
        predicted: null
      }
    })

    if (prediction) {
      const ft = new Date(now.getTime() + 30 * 60000)
      chart.push({
        time: ft.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        glucose: null,
        predicted: prediction.predicted_glucose
      })
    }

    setChartData(chart)
    setLastUpdate(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
    fetchPrediction(newReadings)
  }, [prediction, fetchPrediction])

  useEffect(() => { updateReadings() }, [])
  useEffect(() => {
    const id = setInterval(updateReadings, 30000)
    return () => clearInterval(id)
  }, [updateReadings])

  const tirPct  = readings.length ? Math.round(readings.filter(r => r >= 70 && r <= 180).length / readings.length * 100) : 0
  const meanGlc = readings.length ? Math.round(readings.reduce((a, b) => a + b, 0) / readings.length) : 0
  const hypoPct = readings.length ? Math.round(readings.filter(r => r < 70).length / readings.length * 100) : 0

  const alertStyle = prediction ? alertColors[prediction.alert_level] : alertColors.OK

  return (
    <>
      <style>{fontLink}</style>
      <div style={{
        minHeight: '100vh',
        background: '#080810',
        color: '#e2e8f0',
        fontFamily: '"Syne", sans-serif',
        padding: '0 0 40px'
      }}>
        {/* alert banner */}
        {prediction && prediction.alert_level !== 'OK' && (
          <div style={{
            background: alertStyle.bg,
            borderBottom: `1px solid ${alertStyle.border}`,
            padding: '12px 24px',
            display: 'flex',
            alignItems: 'center',
            gap: 12
          }}>
            <span style={{
              display: 'inline-block',
              width: 8, height: 8, borderRadius: '50%',
              background: alertStyle.text,
              animation: 'pulse 1.5s infinite'
            }} />
            <span style={{
              fontFamily: '"DM Mono", monospace',
              fontSize: 13, color: alertStyle.text
            }}>
              {prediction.message}
            </span>
            {prediction.explanation && (
              <span style={{ fontSize: 12, color: '#475569', marginLeft: 4 }}>
                — {prediction.explanation}
              </span>
            )}
          </div>
        )}

        <div style={{ maxWidth: 520, margin: '0 auto', padding: '0 20px' }}>

          {/* header */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '28px 0 24px'
          }}>
            <div>
              <div style={{
                fontFamily: '"Syne", sans-serif',
                fontSize: 18, fontWeight: 700,
                letterSpacing: '-0.02em',
                color: '#e2e8f0'
              }}>
                diab<span style={{ color: '#8b5cf6' }}>loom</span>
              </div>
              <div style={{
                fontFamily: '"DM Mono", monospace',
                fontSize: 10, color: '#334155',
                letterSpacing: '0.12em', marginTop: 2
              }}>
                T1D COPILOT · {loading ? 'updating...' : `synced ${lastUpdate}`}
              </div>
            </div>

            {/* live glucose hero */}
            <div style={{ textAlign: 'right' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, justifyContent: 'flex-end' }}>
                <span style={{
                  fontFamily: '"DM Mono", monospace',
                  fontSize: 52, fontWeight: 300,
                  color: glucoseColor,
                  lineHeight: 1,
                  letterSpacing: '-0.03em'
                }}>
                  {currentGlucose ?? '—'}
                </span>
                <div>
                  <div style={{
                    fontFamily: '"DM Mono", monospace',
                    fontSize: 11, color: '#475569'
                  }}>mg/dL</div>
                  <div style={{
                    fontFamily: '"DM Mono", monospace',
                    fontSize: 16, color: glucoseColor,
                    lineHeight: 1
                  }}>{trend}</div>
                </div>
              </div>
              {prediction && (
                <div style={{
                  fontFamily: '"DM Mono", monospace',
                  fontSize: 11, color: '#475569', marginTop: 4
                }}>
                  → {prediction.predicted_glucose} in 30min
                </div>
              )}
            </div>
          </div>

          {/* chart */}
          <div style={{
            background: '#0c0c16',
            border: '1px solid rgba(255,255,255,0.04)',
            borderRadius: 16,
            padding: '16px 8px 8px'
          }}>
            <div style={{
              fontFamily: '"DM Mono", monospace',
              fontSize: 10, color: '#334155',
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              padding: '0 12px 12px'
            }}>
              glucose · 2hr window + 30min forecast
            </div>
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                <defs>
                  <linearGradient id="glucGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="predGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="time" tick={{ fill: '#334155', fontSize: 9, fontFamily: '"DM Mono"' }}
                  interval="preserveStartEnd" axisLine={false} tickLine={false} />
                <YAxis domain={[50, 280]} tick={{ fill: '#334155', fontSize: 9, fontFamily: '"DM Mono"' }}
                  axisLine={false} tickLine={false} />
                <Tooltip content={<GlucoseTooltip />} />
                <ReferenceLine y={70}  stroke="#ef444430" strokeDasharray="3 4" />
                <ReferenceLine y={180} stroke="#f59e0b30" strokeDasharray="3 4" />
                <Area type="monotone" dataKey="glucose" stroke="#3b82f6" strokeWidth={1.5}
                  fill="url(#glucGrad)" dot={false} connectNulls={false} name="actual" />
                <Area type="monotone" dataKey="predicted" stroke="#8b5cf6" strokeWidth={1.5}
                  strokeDasharray="4 3" fill="url(#predGrad)"
                  dot={{ fill: '#8b5cf6', r: 4, strokeWidth: 0 }}
                  connectNulls={false} name="predicted" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* stats row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginTop: 12 }}>
            {[
              { label: 'time in range', value: `${tirPct}%`, color: '#22c55e' },
              { label: 'mean glucose', value: meanGlc, color: '#60a5fa' },
              { label: 'hypo time', value: `${hypoPct}%`, color: '#ef4444' },
            ].map(s => (
              <div key={s.label} style={{
                background: '#0c0c16',
                border: '1px solid rgba(255,255,255,0.04)',
                borderRadius: 12,
                padding: '12px 14px',
                textAlign: 'center'
              }}>
                <div style={{
                  fontFamily: '"DM Mono", monospace',
                  fontSize: 22, fontWeight: 400, color: s.color
                }}>{s.value}</div>
                <div style={{
                  fontFamily: '"Syne", sans-serif',
                  fontSize: 9, color: '#334155',
                  textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: 2
                }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* IOB badge */}
          {prediction?.iob && prediction.iob.iob_units > 0 && (
            <div style={{
              marginTop: 10,
              background: 'rgba(139,92,246,0.06)',
              border: '1px solid rgba(139,92,246,0.15)',
              borderRadius: 10,
              padding: '10px 14px',
              display: 'flex',
              alignItems: 'center',
              gap: 10
            }}>
              <div style={{
                fontFamily: '"DM Mono", monospace',
                fontSize: 16, fontWeight: 500, color: '#a78bfa'
              }}>
                {prediction.iob.iob_units}U
              </div>
              <div>
                <div style={{ fontFamily: '"Syne", sans-serif', fontSize: 11, color: '#a78bfa' }}>
                  insulin on board
                </div>
                <div style={{ fontFamily: '"DM Mono", monospace', fontSize: 10, color: '#475569' }}>
                  {prediction.iob.message}
                </div>
              </div>
            </div>
          )}

          {/* insight sentence */}
          {prediction && currentGlucose && (
            <div style={{
              marginTop: 12,
              fontFamily: '"DM Mono", monospace',
              fontSize: 11,
              color: '#334155',
              lineHeight: 1.6,
              padding: '0 4px'
            }}>
              {currentGlucose} mg/dL {trend === '→' ? 'stable' : trend === '↓' || trend === '↘' ? 'dropping' : 'rising'} ·{' '}
              {prediction.predicted_glucose} predicted ·{' '}
              {prediction.iob?.iob_units ? `${prediction.iob.iob_units}U active` : 'no active insulin'}
            </div>
          )}

          {/* action panel */}
          <ActionPanel />

          {/* refresh */}
          <button onClick={updateReadings} style={{
            width: '100%', marginTop: 16,
            background: 'transparent',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 10, padding: '10px',
            fontFamily: '"DM Mono", monospace',
            fontSize: 11, color: '#334155',
            cursor: 'pointer', letterSpacing: '0.06em'
          }}>
            ↺ refresh
          </button>
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </>
  )
}