# fastapi backend
# Run with: uvicorn main:app --reload

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from src.database import (save_glucose_reading, get_recent_readings,
                           save_prediction, get_prediction_history)
from dotenv import load_dotenv
from src.insulin import load_bolus_data, get_iob_context, calculate_iob

import torch
import numpy as np
import sys
import os
import json
load_dotenv()
from groq import Groq
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
groq_client  = Groq(api_key=GROQ_API_KEY)
sys.path.append('.')
from datetime import datetime, timedelta

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

# load bolus data once at startup for IOB calculations
print("Loading bolus data for IOB...")
try:
    BOLUS_DF = load_bolus_data('data/raw/carelink.csv')
    print(f"Bolus data loaded ✓ ({len(BOLUS_DF)} doses)")
except Exception as e:
    print(f"Bolus data not available: {e}")
    BOLUS_DF = None

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

class MealInput(BaseModel):
    description: str
    patient_id:  str = "default"

class MealPredictionInput(BaseModel):
    readings:        list[float]
    meal_description: str = ""
    meal_carbs:      float = 0
    meal_gi:         float = 0
    mins_since_meal: int   = 0
    patient_id:      str   = "default"

class PhotoMealInput(BaseModel):
    image_base64: str
    patient_id:   str = "default"

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

@app.get("/iob")
def get_iob():
    """Returns current insulin on board from CareLink bolus history."""
    if BOLUS_DF is None:
        return {"iob_units": 0, "risk_level": "none",
                "message": "No bolus data available"}
    context = get_iob_context(BOLUS_DF)
    return context

@app.post("/predict/fast")
def predict_fast(body: GlucoseReadings):
    """Fast prediction without SHAP — for real-time use."""
    try:
        window    = preprocess_readings(body.readings)
        predicted = predict_glucose(model, window)

        readings = np.array(body.readings)
        delta_30 = readings[-1] - readings[-6] if len(readings) >= 6 else 0

        if predicted < 70:
            level   = "CRITICAL"
            message = f"⛔ Hypo predicted — {predicted:.0f} mg/dL in 30 mins"
        elif predicted < 95:
            level   = "WARNING"
            message = f"⚠️ Glucose heading low — {predicted:.0f} mg/dL in 30 mins"
        else:
            level   = "OK"
            message = f"Glucose stable — {predicted:.0f} mg/dL predicted"

        if delta_30 < -20:
            explanation = f"Dropping fast — {abs(delta_30):.0f} mg/dL in last 30 mins"
        elif delta_30 < -10:
            explanation = "Gradual downward trend over last 30 mins"
        else:
            explanation = "Glucose trajectory looks stable"

        iob_context = get_iob_context(BOLUS_DF) if BOLUS_DF is not None else None
        if iob_context and iob_context['iob_units'] > 1.0:
            explanation = f"{explanation} + {iob_context['message']}"

        return {
            "predicted_glucose": round(predicted, 1),
            "alert_level":       level,
            "message":           message,
            "explanation":       explanation,
            "iob":               iob_context,
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
    
    last_24 = cgm.tail(24).copy()
    
    # add small realistic noise so chart feels live between exports
    noise = np.random.normal(0, 1.5, len(last_24))
    last_24['glucose'] = (last_24['glucose'] + noise).clip(40, 400).round(1)
    
    return {
        "readings":        last_24['glucose'].tolist(),
        "timestamps":      last_24['timestamp'].astype(str).tolist(),
        "latest_glucose":  float(last_24['glucose'].iloc[-1]),
        "data_as_of":      str(cgm['timestamp'].max()),
        "count":           len(last_24)
    }
# meal intelligence endpts
@app.post("/meal/analyse")
def analyse_meal(body: MealInput):
    """
    Takes a plain English meal description.
    Uses Groq (Llama 3) to extract structured nutrition data.
    Returns carbs, fat, protein, GI, and expected glucose impact.
    """
    try:
        prompt = f"""You are a clinical dietitian specialising in Type 1 Diabetes.
        
Analyse this meal and return ONLY a JSON object with these exact fields:
{{
  "carbs_g": <total carbohydrates in grams, number>,
  "fat_g": <total fat in grams, number>,
  "protein_g": <total protein in grams, number>,
  "gi_score": <average glycemic index 0-100, number>,
  "fiber_g": <dietary fiber in grams, number>,
  "estimated_impact": <one of: "low spike", "moderate spike", "high spike">,
  "peak_time_mins": <estimated minutes until glucose peaks, number>,
  "notes": <one sentence clinical note about this meal for a T1D patient>
}}

Meal: {body.description}

Return ONLY the JSON object. No explanation, no markdown, no backticks."""

        response = groq_client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages = [{"role": "user", "content": prompt}],
            temperature = 0.1,    # low temperature for consistent structured output
            max_tokens=300
        )
        
        raw = response.choices[0].message.content.strip()

        # clean up common LLM formatting issues
        import re
        raw = re.sub(r'<think>.*?</think>', '', raw, flags=re.DOTALL)
        raw = re.sub(r'```json\s*', '', raw)
        raw = re.sub(r'```\s*', '', raw)
        raw = raw.strip()
        
        # parse JSON response
        import json
        nutrition = json.loads(raw)
        
        # save to supabase
        from src.database import save_meal
        save_meal(
            user_id     = body.patient_id,
            description = body.description,
            carbs       = nutrition.get('carbs_g', 0),
            fat         = nutrition.get('fat_g', 0),
            protein     = nutrition.get('protein_g', 0),
            gi          = nutrition.get('gi_score', 0)
        )
        
        return {
            "description": body.description,
            "nutrition":   nutrition,
            "logged":      True
        }
    
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, 
                          detail="Failed to parse nutrition data from LLM")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/meal/predict-impact")
def predict_meal_impact(body: MealPredictionInput):
    """
    Combines glucose prediction with meal context.
    If meal was recently logged, adjusts prediction narrative accordingly.
    """
    try:
        # get base glucose prediction
        window    = preprocess_readings(body.readings)
        predicted = predict_glucose(model, window)
        
        # adjust alert message based on meal context
        meal_context = ""
        adjusted_prediction = predicted
        
        if body.meal_carbs > 0 and body.mins_since_meal < 120:
            # post meal — glucose will likely rise
            carb_impact = body.meal_carbs * 0.4   # rough: 1g carb ≈ 0.4 mg/dL rise
            time_factor = 1 - (body.mins_since_meal / 120)
            adjusted_prediction = predicted + (carb_impact * time_factor * 0.3)
            
            if body.meal_gi > 70:
                meal_context = (f"High GI meal ({body.meal_description}) logged "
                               f"{body.mins_since_meal} mins ago — "
                               f"fast spike likely")
            elif body.meal_gi > 50:
                meal_context = (f"Moderate GI meal logged "
                               f"{body.mins_since_meal} mins ago — "
                               f"gradual rise expected")
            else:
                meal_context = (f"Low GI meal logged — "
                               f"slow glucose rise expected")
        
        # determine alert level
        if adjusted_prediction < 70:
            level   = "CRITICAL"
            message = f"⛔ Hypo predicted — {adjusted_prediction:.0f} mg/dL in 30 mins"
        elif adjusted_prediction < 95:
            level   = "WARNING"
            message = f"⚠️ Glucose heading low — {adjusted_prediction:.0f} mg/dL in 30 mins"
        elif adjusted_prediction > 250:
            level   = "HIGH"
            message = f"📈 High glucose predicted — {adjusted_prediction:.0f} mg/dL in 30 mins"
        else:
            level   = "OK"
            message = f"Glucose stable — {adjusted_prediction:.0f} mg/dL predicted"
        
        return {
            "predicted_glucose":  round(adjusted_prediction, 1),
            "base_prediction":    round(predicted, 1),
            "alert_level":        level,
            "message":            message,
            "meal_context":       meal_context,
            "error_margin":       18.5
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
    class PhotoMealInput(BaseModel):
        image_base64: str       # base64 encoded image
        patient_id:   str = "default"

@app.post("/meal/analyse-photo")
def analyse_meal_photo(body: PhotoMealInput):
    """
    Takes a base64 photo of a meal.
    Uses Groq vision to identify food and extract nutrition.
    """
    try:
        response = groq_client.chat.completions.create(
            model="meta-llama/llama-4-scout-17b-16e-instruct",
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/jpeg;base64,{body.image_base64}"
                        }
                    },
                    {
                        "type": "text",
                        "text": """You are a clinical dietitian specialising in Type 1 Diabetes.
                        
Identify all foods visible in this image and return ONLY a JSON object:
{
  "identified_foods": ["food1", "food2"],
  "carbs_g": <number>,
  "fat_g": <number>,
  "protein_g": <number>,
  "gi_score": <number 0-100>,
  "fiber_g": <number>,
  "estimated_impact": <"low spike" or "moderate spike" or "high spike">,
  "peak_time_mins": <number>,
  "notes": <one sentence for T1D patient>
}

Return ONLY the JSON. No explanation, no markdown."""
                    }
                ]
            }],
            temperature=0.1
        )
        
        raw       = response.choices[0].message.content.strip()
        nutrition = json.loads(raw)
        
        # save to database
        from src.database import save_meal
        save_meal(
            user_id     = body.patient_id,
            description = ', '.join(nutrition.get('identified_foods', ['unknown'])),
            carbs       = nutrition.get('carbs_g', 0),
            fat         = nutrition.get('fat_g', 0),
            protein     = nutrition.get('protein_g', 0),
            gi          = nutrition.get('gi_score', 0)
        )
        
        return {"nutrition": nutrition, "logged": True}
    
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="Failed to parse nutrition from image")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
    @app.get("/iob")
    def get_iob():
        """
        Returns current insulin on board from CareLink bolus history.
        """
        if BOLUS_DF is None:
            return {"iob_units": 0, "risk_level": "none", 
                "message": "No bolus data available"}
        context = get_iob_context(BOLUS_DF)
        return context

@app.get("/iob/history")
def get_iob_history():
    """
    Returns IOB curve for the last 6 hours — useful for charting.
    """
    if BOLUS_DF is None:
        return {"history": []}
    
    from datetime import datetime, timedelta
    now     = datetime.now()
    history = []
    
    # compute IOB every 5 mins for last 6 hours
    for mins_back in range(360, -5, -5):
        t   = now - timedelta(minutes=mins_back)
        iob = calculate_iob(BOLUS_DF, t)
        history.append({
            "time":     t.strftime('%H:%M'),
            "iob":      iob,
            "mins_ago": mins_back
        })
    
    return {"history": history}

class ActivityLog(BaseModel):
    activity_type: str    # "exercise", "walk", "sport", "other"
    intensity:     str    # "light", "moderate", "intense"
    duration_mins: int
    patient_id:    str = "default"

@app.post("/activity/log")
def log_activity(body: ActivityLog):
    """
    Logs an activity event.
    Flags next 2 hours as elevated hypo risk.
    Exercise drops glucose for up to 12 hours post-activity.
    """
    # calculate risk window based on intensity
    risk_windows = {
        "light":    120,   # 2 hrs elevated risk
        "moderate": 240,   # 4 hrs
        "intense":  480    # 8 hrs
    }
    risk_mins = risk_windows.get(body.intensity, 120)
    
    # save to supabase
    from src.database import supabase
    supabase.table("activity_logs").insert({
        "user_id":       body.patient_id,
        "activity_type": body.activity_type,
        "intensity":     body.intensity,
        "duration_mins": body.duration_mins,
        "risk_until": (
            datetime.utcnow() + timedelta(minutes=risk_mins)
        ).isoformat()
    }).execute()
    
    return {
        "logged":        True,
        "activity":      body.activity_type,
        "intensity":     body.intensity,
        "risk_window":   f"Elevated hypo risk for next {risk_mins//60} hours",
        "advice":        f"Monitor closely — {body.intensity} exercise increases hypo risk"
    }

@app.post("/meal/debug")
def debug_meal(body: MealInput):
    prompt = f"""You are a clinical dietitian specialising in Type 1 Diabetes.
Analyse this meal and return ONLY a JSON object with these exact fields:
{{
  "carbs_g": <total carbohydrates in grams, number>,
  "fat_g": <total fat in grams, number>,
  "protein_g": <total protein in grams, number>,
  "gi_score": <average glycemic index 0-100, number>,
  "fiber_g": <dietary fiber in grams, number>,
  "estimated_impact": <one of: "low spike", "moderate spike", "high spike">,
  "peak_time_mins": <estimated minutes until glucose peaks, number>,
  "notes": <one sentence clinical note about this meal for a T1D patient>
}}
Meal: {body.description}
Return ONLY the JSON object. No explanation, no markdown, no backticks."""

    response = groq_client.chat.completions.create(
        model="qwen/qwen3.6-27b",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.1
    )
    raw = response.choices[0].message.content
    return {"raw": raw}