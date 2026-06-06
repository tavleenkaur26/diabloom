# supabase connection and database operations

from supabase import create_client, Client
from dotenv import load_dotenv
import os
load_dotenv() 
from datetime import datetime

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

print(f"Supabase URL loaded: {SUPABASE_URL is not None}") 

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

def save_glucose_reading(user_id: str, glucose: float, 
                          timestamp: str = None, source: str = 'manual'):
    """Save one glucose reading to database"""
    data = {
        "user_id":   user_id,
        "glucose":   glucose,
        "timestamp": timestamp or datetime.utcnow().isoformat(),
        "source":    source
    }
    result = supabase.table("glucose_readings").insert(data).execute()
    return result.data

def get_recent_readings(user_id: str, limit: int = 24):
    """Get last N glucose readings for a user"""
    result = (supabase.table("glucose_readings")
              .select("*")
              .eq("user_id", user_id)
              .order("timestamp", desc=True)
              .limit(limit)
              .execute())
    # reverse so oldest first (correct order for LSTM)
    return list(reversed(result.data))

# predictions
def save_prediction(user_id: str, predicted_glucose: float,
                    alert_level: str, message: str, 
                    explanation: str, error_margin: float):
    """Save a prediction to database"""
    data = {
        "user_id":           user_id,
        "predicted_glucose": predicted_glucose,
        "alert_level":       alert_level,
        "message":           message,
        "explanation":       explanation,
        "error_margin":      error_margin
    }
    result = supabase.table("predictions").insert(data).execute()
    return result.data

def get_prediction_history(user_id: str, limit: int = 10):
    """Get recent predictions for a user"""
    result = (supabase.table("predictions")
              .select("*")
              .eq("user_id", user_id)
              .order("created_at", desc=True)
              .limit(limit)
              .execute())
    return result.data

# meal logs─
def save_meal(user_id: str, description: str, 
              carbs: float, fat: float, 
              protein: float, gi: float):
    """Save a meal log"""
    data = {
        "user_id":     user_id,
        "description": description,
        "carbs_g":     carbs,
        "fat_g":       fat,
        "protein_g":   protein,
        "gi_score":    gi
    }
    result = supabase.table("meal_logs").insert(data).execute()
    return result.data

def get_meal_history(user_id: str, limit: int = 10):
    """Get recent meals for a user"""
    result = (supabase.table("meal_logs")
              .select("*")
              .eq("user_id", user_id)
              .order("logged_at", desc=True)
              .limit(limit)
              .execute())
    return result.data