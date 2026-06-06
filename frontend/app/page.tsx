'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import axios from 'axios'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer, Legend
} from 'recharts'

//types
interface PredictionResponse {
  predicted_glucose: number
  alert_level: 'OK' | 'WARNING' | 'CRITICAL'
  message: string
  explanation: string
  error_margin: number
}

interface GlucosePoint {
  time: string
  glucose: number
  predicted?: number
}

// simulated live glucose feed
// in production this comes from Tidepool/Nightscout API
// for now simulated a dropping glucose pattern
async function fetchRealReadings(): Promise<number[]> {
  try {
    const res = await axios.get('http://127.0.0.1:8000/mydata/latest')
    return res.data.readings
  } catch (err) {
    console.error('Failed to fetch real readings:', err)
    // fallback to synthetic if backend unreachable
    return Array.from({ length: 24 }, (_, i) => 
      Math.max(50, 140 - i * 2 + (Math.random() - 0.5) * 10)
    )
  }
}

// alert card component
function AlertCard({ prediction }: { prediction: PredictionResponse | null }) {
  if (!prediction) return null

  const colours = {
    OK:       'border-green-500  bg-green-950  text-green-300',
    WARNING:  'border-yellow-500 bg-yellow-950 text-yellow-300',
    CRITICAL: 'border-red-500    bg-red-950    text-red-300',
  }

  const icons = { OK: '✅', WARNING: '⚠️', CRITICAL: '⛔' }

  return (
    <div className={`border-2 rounded-xl p-4 mb-4 ${colours[prediction.alert_level]}`}>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xl">{icons[prediction.alert_level]}</span>
        <span className="font-bold text-lg">{prediction.message}</span>
      </div>
      {prediction.explanation && (
        <p className="text-sm opacity-80 mt-1">{prediction.explanation}</p>
      )}
      <p className="text-xs opacity-50 mt-2">
        Model error margin: ±{prediction.error_margin} mg/dL
      </p>
    </div>
  )
}

// stats bar component
function StatsBar({ readings }: { readings: number[] }) {
  const hypo    = readings.filter(r => r < 70).length
  const inRange = readings.filter(r => r >= 70 && r <= 180).length
  const mean    = readings.reduce((a, b) => a + b, 0) / readings.length

  const tirPct  = Math.round((inRange / readings.length) * 100)
  const hypoPct = Math.round((hypo    / readings.length) * 100)

  return (
    <div className="grid grid-cols-3 gap-4 mt-4">
      <div className="bg-gray-900 rounded-xl p-4 text-center">
        <p className="text-xs text-gray-400 mb-1">Time In Range</p>
        <p className="text-2xl font-bold text-green-400">{tirPct}%</p>
      </div>
      <div className="bg-gray-900 rounded-xl p-4 text-center">
        <p className="text-xs text-gray-400 mb-1">Mean Glucose</p>
        <p className="text-2xl font-bold text-blue-400">{Math.round(mean)}</p>
        <p className="text-xs text-gray-500">mg/dL</p>
      </div>
      <div className="bg-gray-900 rounded-xl p-4 text-center">
        <p className="text-xs text-gray-400 mb-1">Hypo Readings</p>
        <p className="text-2xl font-bold text-red-400">{hypoPct}%</p>
      </div>
    </div>
  )
}

// custom tooltip for chart
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 text-sm">
      <p className="text-gray-400 mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ color: p.color }}>
          {p.name}: <strong>{Math.round(p.value)} mg/dL</strong>
        </p>
      ))}
    </div>
  )
}
//meal logger component
function MealLogger() {
  const [description, setDescription] = useState('')
  const [nutrition,   setNutrition]   = useState<any>(null)
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState('')
  const [mode,        setMode]        = useState<'text'|'camera'>('text')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const analyseMealText = async () => {
    if (!description.trim()) return
    setLoading(true)
    setError('')
    setNutrition(null)
    try {
      const res = await axios.post('http://127.0.0.1:8000/meal/analyse', {
        description,
        patient_id: '550e8400-e29b-41d4-a716-446655440000'
      })
      setNutrition(res.data.nutrition)
    } catch {
      setError('Failed to analyse meal.')
    } finally {
      setLoading(false)
    }
  }

  const analyseMealPhoto = async (file: File) => {
    setLoading(true)
    setError('')
    setNutrition(null)
    try {
      // convert image to base64
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload  = () => resolve((reader.result as string).split(',')[1])
        reader.onerror = reject
        reader.readAsDataURL(file)
      })

      const res = await axios.post('http://127.0.0.1:8000/meal/analyse-photo', {
        image_base64: base64,
        patient_id:   '550e8400-e29b-41d4-a716-446655440000'
      })
      setNutrition(res.data.nutrition)
    } catch {
      setError('Failed to analyse photo.')
    } finally {
      setLoading(false)
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) analyseMealPhoto(file)
  }

  const impactColour: Record<string, string> = {
    'low spike':      'text-green-400',
    'moderate spike': 'text-yellow-400',
    'high spike':     'text-red-400'
  }

  const impactIcon: Record<string, string> = {
    'low spike':      '🟢',
    'moderate spike': '🟡',
    'high spike':     '🔴'
  }

  return (
    <div className="bg-gray-900 rounded-xl p-4 mt-4">
      <p className="text-sm text-gray-400 mb-3">🍽️ Log a Meal</p>

      {/* mode toggle */}
      <div className="flex gap-2 mb-3">
        <button
          onClick={() => setMode('text')}
          className={`text-xs px-3 py-1 rounded-lg transition-colors
                      ${mode === 'text' 
                        ? 'bg-blue-600 text-white' 
                        : 'bg-gray-800 text-gray-400'}`}
        >
          ✏️ Type
        </button>
        <button
          onClick={() => setMode('camera')}
          className={`text-xs px-3 py-1 rounded-lg transition-colors
                      ${mode === 'camera' 
                        ? 'bg-blue-600 text-white' 
                        : 'bg-gray-800 text-gray-400'}`}
        >
          📷 Photo
        </button>
      </div>

      {/* text mode */}
      {mode === 'text' && (
        <div className="flex gap-2 mb-3">
          <input
            type="text"
            value={description}
            onChange={e => setDescription(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && analyseMealText()}
            placeholder="e.g. 2 rotis, dal, small rice, curd"
            className="flex-1 bg-gray-800 text-white text-sm
                       rounded-lg px-3 py-2 outline-none
                       border border-gray-700 focus:border-blue-500"
          />
          <button
            onClick={analyseMealText}
            disabled={loading || !description.trim()}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50
                       text-white text-sm font-medium px-4 py-2
                       rounded-lg transition-colors"
          >
            {loading ? '...' : 'Analyse'}
          </button>
        </div>
      )}

      {/* camera mode */}
      {mode === 'camera' && (
        <div className="mb-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleFileChange}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={loading}
            className="w-full bg-gray-800 hover:bg-gray-700 
                       border-2 border-dashed border-gray-600
                       text-gray-400 text-sm py-6 rounded-lg
                       transition-colors disabled:opacity-50"
          >
            {loading ? 'Analysing photo...' : '📷 Tap to take photo or upload'}
          </button>
        </div>
      )}

      {error && <p className="text-red-400 text-xs mb-2">{error}</p>}

      {/* nutrition result */}
      {nutrition && (
        <div className="bg-gray-800 rounded-lg p-3">
          {/* identified foods (photo mode) */}
          {nutrition.identified_foods && (
            <p className="text-xs text-gray-400 mb-2">
              Identified: {nutrition.identified_foods.join(', ')}
            </p>
          )}

          {/* impact badge */}
          <p className={`text-sm font-bold mb-2
                        ${impactColour[nutrition.estimated_impact] || 'text-white'}`}>
            {impactIcon[nutrition.estimated_impact] || '⚪'}
            {' '}{nutrition.estimated_impact} — peaks ~{nutrition.peak_time_mins} mins
          </p>

          {/* nutrition grid */}
          <div className="grid grid-cols-4 gap-2 mb-2">
            {[
              { label: 'Carbs',   value: `${nutrition.carbs_g}g`,   color: 'text-orange-400' },
              { label: 'Fat',     value: `${nutrition.fat_g}g`,     color: 'text-yellow-400' },
              { label: 'Protein', value: `${nutrition.protein_g}g`, color: 'text-blue-400'   },
              { label: 'GI',      value: nutrition.gi_score,        color: 'text-purple-400' },
            ].map(item => (
              <div key={item.label} className="text-center">
                <p className={`text-lg font-bold ${item.color}`}>{item.value}</p>
                <p className="text-xs text-gray-500">{item.label}</p>
              </div>
            ))}
          </div>

          {/* clinical note */}
          <p className="text-xs text-gray-400 italic">{nutrition.notes}</p>
        </div>
      )}
    </div>
  )
}

// activity logger
function ActivityLogger() {
  const [intensity, setIntensity] = useState<'light'|'moderate'|'intense'|''>('')
  const [activity,  setActivity]  = useState('exercise')
  const [duration,  setDuration]  = useState(30)
  const [result,    setResult]    = useState<any>(null)
  const [loading,   setLoading]   = useState(false)

  const logActivity = async () => {
    if (!intensity) return
    setLoading(true)
    try {
      const res = await axios.post('http://127.0.0.1:8000/activity/log', {
        activity_type: activity,
        intensity,
        duration_mins: duration,
        patient_id:    '550e8400-e29b-41d4-a716-446655440000'
      })
      setResult(res.data)
    } catch {
      console.error('Failed to log activity')
    } finally {
      setLoading(false)
    }
  }

  const intensityColour = {
    light:    'bg-green-600  hover:bg-green-700',
    moderate: 'bg-yellow-600 hover:bg-yellow-700',
    intense:  'bg-red-600    hover:bg-red-700'
  }

  return (
    <div className="bg-gray-900 rounded-xl p-4 mt-4">
      <p className="text-sm text-gray-400 mb-3">🏃 Log Activity</p>

      {/* activity type */}
      <div className="flex gap-2 mb-3">
        {['exercise','walk','sport','other'].map(a => (
          <button key={a}
            onClick={() => setActivity(a)}
            className={`text-xs px-3 py-1 rounded-lg capitalize transition-colors
                        ${activity === a 
                          ? 'bg-blue-600 text-white' 
                          : 'bg-gray-800 text-gray-400'}`}
          >
            {a}
          </button>
        ))}
      </div>

      {/* intensity */}
      <p className="text-xs text-gray-500 mb-2">Intensity</p>
      <div className="flex gap-2 mb-3">
        {(['light','moderate','intense'] as const).map(i => (
          <button key={i}
            onClick={() => setIntensity(i)}
            className={`text-xs px-3 py-1 rounded-lg capitalize transition-colors
                        ${intensity === i 
                          ? intensityColour[i] + ' text-white'
                          : 'bg-gray-800 text-gray-400'}`}
          >
            {i}
          </button>
        ))}
      </div>

      {/* duration */}
      <div className="flex items-center gap-3 mb-3">
        <p className="text-xs text-gray-500">Duration:</p>
        <input
          type="range" min={5} max={120} step={5}
          value={duration}
          onChange={e => setDuration(Number(e.target.value))}
          className="flex-1"
        />
        <p className="text-xs text-white w-12">{duration} mins</p>
      </div>

      <button
        onClick={logActivity}
        disabled={!intensity || loading}
        className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50
                   text-white text-sm font-medium py-2 rounded-lg transition-colors"
      >
        {loading ? 'Logging...' : 'Log Activity'}
      </button>

      {result && (
        <div className="mt-3 bg-gray-800 rounded-lg p-3">
          <p className="text-yellow-400 text-sm font-medium">
            ⚠️ {result.risk_window}
          </p>
          <p className="text-xs text-gray-400 mt-1">{result.advice}</p>
        </div>
      )}
    </div>
  )
}

// main dashboard
export default function Dashboard() {
  const [readings,   setReadings]   = useState<number[]>([])
  const [chartData,  setChartData]  = useState<GlucosePoint[]>([])
  const [prediction, setPrediction] = useState<PredictionResponse | null>(null)
  const [loading,    setLoading]    = useState(false)
  const [lastUpdate, setLastUpdate] = useState<string>('')

  const fetchPrediction = useCallback(async (currentReadings: number[]) => {
    setLoading(true)
    try {
      const res = await axios.post('http://127.0.0.1:8000/predict/fast', {
        readings:   currentReadings,
        patient_id: 'demo'
      })
      setPrediction(res.data)
    } catch (err) {
      console.error('Prediction failed:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  const updateReadings = useCallback(async () => {
    const newReadings = await fetchRealReadings()
    setReadings(newReadings)

    // build chart data — last 24 actual + 1 predicted point
    const now   = new Date()
    const chart = newReadings.map((glucose, i) => {
      const t = new Date(now.getTime() - (23 - i) * 5 * 60000)
      return {
        time:    t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        glucose: Math.round(glucose)
      }
    })

    // add predicted point 30 mins into future
    if (prediction) {
      const futureTime = new Date(now.getTime() + 30 * 60000)
      chart.push({
        time:      futureTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        glucose:   undefined as any,
        predicted: prediction.predicted_glucose
      })
    }

    setChartData(chart)
    setLastUpdate(now.toLocaleTimeString())
    fetchPrediction(newReadings)
  }, [prediction, fetchPrediction])

  // initial load
  useEffect(() => {
    updateReadings()
  }, [])

  // simulate live CGM — new reading every 30 seconds for demo
  useEffect(() => {
    const interval = setInterval(updateReadings, 30000)
    return () => clearInterval(interval)
  }, [updateReadings])

  return (
    <main className="min-h-screen bg-gray-950 text-white p-6 max-w-4xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-blue-400">DiabLoom</h1>
          <p className="text-gray-500 text-sm">T1D Copilot — Hypo Prediction</p>
        </div>
        <div className="text-right">
          {loading && <p className="text-yellow-400 text-xs">Analysing...</p>}
          <p className="text-gray-600 text-xs">Updated {lastUpdate}</p>
          {readings.length > 0 && (
            <p className="text-4xl font-bold text-white mt-1">
              {Math.round(readings[readings.length - 1])}
              <span className="text-lg text-gray-400 ml-1">mg/dL</span>
            </p>
          )}
        </div>
      </div>

      {/* Alert Card */}
      <AlertCard prediction={prediction} />

      {/* Glucose Chart */}
      <div className="bg-gray-900 rounded-xl p-4 mb-4">
        <p className="text-sm text-gray-400 mb-3">
          Glucose — Last 2 Hours + 30min Prediction
        </p>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis
              dataKey="time"
              tick={{ fill: '#6b7280', fontSize: 11 }}
              interval="preserveStartEnd"
            />
            <YAxis
              domain={[40, 400]}
              tick={{ fill: '#6b7280', fontSize: 11 }}
              tickFormatter={v => `${v}`}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend />

            {/* danger zone shading via reference lines */}
            <ReferenceLine y={70}  stroke="#ef4444" strokeDasharray="4 4"
                           label={{ value: 'Hypo', fill: '#ef4444', fontSize: 11 }} />
            <ReferenceLine y={180} stroke="#f59e0b" strokeDasharray="4 4"
                           label={{ value: 'Hyper', fill: '#f59e0b', fontSize: 11 }} />

            {/* actual glucose line */}
            <Line
              type="monotone"
              dataKey="glucose"
              stroke="#60a5fa"
              strokeWidth={2}
              dot={false}
              name="Actual"
              connectNulls={false}
            />

            {/* predicted glucose — dashed orange */}
            <Line
              type="monotone"
              dataKey="predicted"
              stroke="#f59e0b"
              strokeWidth={2}
              strokeDasharray="6 3"
              dot={{ fill: '#f59e0b', r: 5 }}
              name="Predicted (30min)"
              connectNulls={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Stats */}
      <StatsBar readings={readings} />
      <MealLogger />
      <ActivityLogger />

      {/* Manual refresh */}
      <button
        onClick={updateReadings}
        className="mt-4 w-full bg-blue-600 hover:bg-blue-700 
                   text-white font-medium py-2 px-4 rounded-xl 
                   transition-colors duration-200"
      >
        Refresh Readings
      </button>

    </main>
  )
}