# fastapi backend
# Run with: uvicorn main:app --reload

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from src.database import (save_glucose_reading, get_recent_readings,
                           save_prediction, get_prediction_history)
import torch
import numpy as np
import sys
import os
sys.path.append('.')

from src.model import GlucoseLSTM
from src.explain import (predict_glucose, get_feature_importance, 
                          generate_alert)
from src.dataset import GlucoseDataset

# app setup
app = FastAPI(
    title="DiaBloom API",
    description="T1D Copilot — Hypo prediction with explainability",
    version="1.0.0"
)

# allow frontend to talk to backend (CORS)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],    # tighten this in production
    allow_methods=["*"],
    allow_headers=["*"],
)

# load model once at startup
print("Loading model...")
model = GlucoseLSTM()
model.load_state_dict(torch.load('models/glucose_lstm.pt', 
                                  map_location='cpu'))
model.eval()
print("Model loaded ✓")

# load background data for SHAP once at startup
print("Loading background data for SHAP...")
val_ds         = GlucoseDataset(split='val')
BACKGROUND     = val_ds.X.numpy()[:50]   # 50 samples is enough for SHAP
print("Background data ready ✓")

# req/response models
class GlucoseReadings(BaseModel):
    """
    readings: list of last 24 glucose values in mg/dL
              oldest first, newest last
    patient_id: optional, for future personalisation
    """
    readings:   list[float]
    patient_id: str = "default"

class PredictionResponse(BaseModel):
    predicted_glucose:  float
    alert_level:        str    # OK / WARNING / CRITICAL
    message:            str
    explanation:        str | None
    top_features:       list[str] | None
    error_margin:       float     # ± mg/dL based on validation MAE

# helper: preprocess raw readings into model input 
def preprocess_readings(readings: list[float]) -> np.ndarray:
    """
    Takes 24 raw glucose readings in mg/dL
    Applies same feature engineering as training pipeline
    Returns numpy array shape (24, 8) ready for model
    """
    import pandas as pd
    
    if len(readings) != 24:
        raise ValueError(f"Expected 24 readings, got {len(readings)}")
    
    df = pd.DataFrame({
        'glucose': readings,
        'timestamp': pd.date_range('2024-01-01', periods=24, freq='5min')
    })
    
    # engineer features — must match dataset.py exactly
    df['delta_1']  = df['glucose'].diff()
    df['delta_3']  = df['glucose'].diff(3)
    df['delta_6']  = df['glucose'].diff(6)
    df['rolling_mean_12'] = df['glucose'].rolling(12).mean()
    df['rolling_std_12']  = df['glucose'].rolling(12).std()
    df['hour']     = df['timestamp'].dt.hour
    df['hour_sin'] = np.sin(2 * np.pi * df['hour'] / 24)
    df['hour_cos'] = np.cos(2 * np.pi * df['hour'] / 24)
    
    # fill NaN from diff/rolling with 0 for first few rows
    df = df.fillna(0)
    
    # normalise glucose
    G_MIN, G_MAX = 40, 400
    df['glucose_norm'] = (df['glucose'] - G_MIN) / (G_MAX - G_MIN)
    
    # normalise delta features
    for col in ['delta_1','delta_3','delta_6','rolling_mean_12','rolling_std_12']:
        mean = df[col].mean()
        std  = df[col].std() + 1e-8
        df[col] = (df[col] - mean) / std
    
    features = ['glucose_norm','delta_1','delta_3','delta_6',
                'rolling_mean_12','rolling_std_12','hour_sin','hour_cos']
    
    return df[features].values.astype(np.float32)   # (24, 8)

# routes

@app.get("/")
def root():
    return {
        "name":    "DiaBloom API",
        "status":  "running",
        "version": "1.0.0"
    }

@app.get("/health")
def health():
    return {"status": "ok", "model_loaded": True}

@app.post("/predict", response_model=PredictionResponse)
def predict(body: GlucoseReadings):
    """
    Main endpoint. Takes 24 glucose readings, returns prediction + alert.
    """
    try:
        # preprocess
        window = preprocess_readings(body.readings)
        
        # predict
        predicted = predict_glucose(model, window)
        
        # explain (skip SHAP for speed — use feature importance proxy)
        importance = get_feature_importance(model, window, BACKGROUND)
        
        # generate alert
        alert = generate_alert(predicted, importance, threshold=95)
        
        return PredictionResponse(
            predicted_glucose = alert['predicted_glucose'],
            alert_level       = alert['level'],
            message           = alert['message'],
            explanation       = alert.get('explanation'),
            top_features      = alert.get('top_features'),
            error_margin      = 18.5    # from validation MAE
        )
    
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/predict/fast")
def predict_fast(body: GlucoseReadings):
    """
    Fast prediction without SHAP — for real-time use.
    Returns prediction in <100ms.
    """
    try:
        window    = preprocess_readings(body.readings)
        predicted = predict_glucose(model, window)
        
        # simple rule-based explanation without SHAP
        readings  = np.array(body.readings)
        delta_30  = readings[-1] - readings[-6] if len(readings) >= 6 else 0
        
        if predicted < 70:
            level   = "CRITICAL"
            message = f"⛔ Hypo predicted — {predicted:.0f} mg/dL in 30 mins"
        elif predicted < 90:
            level   = "WARNING"
            message = f"⚠️ Glucose heading low — {predicted:.0f} mg/dL in 30 mins"
        else:
            level   = "OK"
            message = f"Glucose stable — {predicted:.0f} mg/dL predicted"
        
        # simple explanation from raw delta
        if delta_30 < -20:
            explanation = f"Dropping fast — {abs(delta_30):.0f} mg/dL in last 30 mins"
        elif delta_30 < -10:
            explanation = f"Gradual downward trend over last 30 mins"
        else:
            explanation = "Glucose trajectory looks stable"
        
        return {
            "predicted_glucose": round(predicted, 1),
            "alert_level":       level,
            "message":           message,
            "explanation":       explanation,
            "error_margin":      18.5
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
   #database endpts

class ReadingInput(BaseModel):
    user_id:   str
    glucose:   float
    timestamp: str = None
    source:    str = 'manual'

@app.post("/readings/save")
def save_reading(body: ReadingInput):
    """Save a glucose reading to database"""
    result = save_glucose_reading(
        body.user_id, body.glucose, 
        body.timestamp, body.source
    )
    return {"saved": True, "data": result}

@app.get("/readings/{user_id}")
def get_readings(user_id: str, limit: int = 24):
    """Get recent readings for a user from database"""
    readings = get_recent_readings(user_id, limit)
    return {"readings": readings, "count": len(readings)}

@app.post("/predict/save")
def predict_and_save(body: GlucoseReadings):
    """
    Predict AND save both the readings and prediction to database.
    This is the main endpoint the frontend will call.
    """
    try:
        # save each reading
        for i, glucose in enumerate(body.readings):
            from datetime import datetime, timedelta
            ts = (datetime.utcnow() - 
                  timedelta(minutes=5*(23-i))).isoformat()
            save_glucose_reading(body.patient_id, glucose, ts)
        
        # run prediction
        window    = preprocess_readings(body.readings)
        predicted = predict_glucose(model, window)
        importance = get_feature_importance(model, window, BACKGROUND)
        alert     = generate_alert(predicted, importance, threshold=95)
        
        # save prediction
        save_prediction(
            user_id           = body.patient_id,
            predicted_glucose = alert['predicted_glucose'],
            alert_level       = alert['level'],
            message           = alert['message'],
            explanation       = alert.get('explanation', ''),
            error_margin      = 18.5
        )
        
        return PredictionResponse(
            predicted_glucose = alert['predicted_glucose'],
            alert_level       = alert['level'],
            message           = alert['message'],
            explanation       = alert.get('explanation'),
            top_features      = alert.get('top_features'),
            error_margin      = 18.5
        )
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/history/{user_id}")
def get_history(user_id: str):
    """Get prediction history for a user"""
    predictions = get_prediction_history(user_id)
    return {"predictions": predictions}

@app.get("/mydata/latest")
def get_my_latest_readings():
    """
    Returns your last 24 real CGM readings from CareLink export.
    This replaces synthetic data in the frontend.
    """
    import pandas as pd
    
    df = pd.read_csv('data/raw/carelink.csv', 
                     skiprows=6, on_bad_lines='skip')
    
    df['timestamp'] = pd.to_datetime(
        df['Date'].astype(str) + ' ' + df['Time'].astype(str),
        format='%Y/%m/%d %H:%M:%S', errors='coerce'
    )
    
    cgm = df[df['Sensor Glucose (mg/dL)'].notna()][
        ['timestamp', 'Sensor Glucose (mg/dL)']
    ].copy()
    cgm.columns = ['timestamp', 'glucose']
    cgm['glucose'] = pd.to_numeric(cgm['glucose'], errors='coerce')
    cgm = cgm.dropna().sort_values('timestamp').reset_index(drop=True)
    
    # get last 24 readings
    last_24 = cgm.tail(24)
    
    return {
        "readings": last_24['glucose'].tolist(),
        "timestamps": last_24['timestamp'].astype(str).tolist(),
        "latest_glucose": float(last_24['glucose'].iloc[-1]),
        "count": len(last_24)
    }