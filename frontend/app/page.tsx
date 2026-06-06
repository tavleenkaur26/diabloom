'use client'

import { useState, useEffect, useCallback } from 'react'
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