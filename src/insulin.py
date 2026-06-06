# Insulin on Board calculation from CareLink bolus data

import pandas as pd
import numpy as np
from datetime import datetime, timezone

def load_bolus_data(filepath='data/raw/carelink.csv'):
    """Load bolus doses from CareLink export"""
    df = pd.read_csv(filepath, skiprows=6, on_bad_lines='skip')
    
    df['timestamp'] = pd.to_datetime(
        df['Date'].astype(str) + ' ' + df['Time'].astype(str),
        format='%Y/%m/%d %H:%M:%S', errors='coerce'
    )
    
    bolus = df[df['Bolus Volume Delivered (U)'].notna()][
        ['timestamp', 'Bolus Volume Delivered (U)', 'BWZ Carb Input (grams)']
    ].copy()
    bolus.columns = ['timestamp', 'bolus_units', 'carbs_g']
    bolus['bolus_units'] = pd.to_numeric(bolus['bolus_units'], errors='coerce')
    bolus['carbs_g']     = pd.to_numeric(bolus['carbs_g'],     errors='coerce')
    bolus = bolus.dropna(subset=['bolus_units']).sort_values('timestamp')
    return bolus

def calculate_iob(bolus_df, current_time=None, 
                  peak_mins=60, duration_mins=240):
    """
    Calculate total insulin on board at current_time.
    
    Uses a triangular activity curve:
    - Insulin activity rises from 0 to peak at peak_mins
    - Then falls from peak back to 0 at duration_mins
    
    peak_mins=60     insulin peaks at 60 mins (NovoRapid/Humalog typical)
    duration_mins=240  insulin gone after 4 hours
    
    Returns IOB in units (float)
    """
    if current_time is None:
        current_time = datetime.now()
    
    # make both timezone naive for comparison
    if hasattr(current_time, 'tzinfo') and current_time.tzinfo:
        current_time = current_time.replace(tzinfo=None)
    
    iob = 0.0
    
    for _, bolus in bolus_df.iterrows():
        ts = bolus['timestamp']
        if hasattr(ts, 'tzinfo') and ts.tzinfo:
            ts = ts.replace(tzinfo=None)
        
        mins_ago = (current_time - ts).total_seconds() / 60
        
        # only consider boluses within activity window
        if 0 < mins_ago < duration_mins:
            if mins_ago < peak_mins:
                # rising phase
                activity = mins_ago / peak_mins
            else:
                # falling phase
                activity = (duration_mins - mins_ago) / (duration_mins - peak_mins)
            
            iob += bolus['bolus_units'] * max(0, activity)
    
    return round(iob, 2)

def get_iob_context(bolus_df, current_time=None):
    """
    Returns IOB value + plain English context for alerts.
    """
    iob = calculate_iob(bolus_df, current_time)
    
    if iob > 3:
        risk    = "high"
        message = f"{iob}U insulin still active — significant hypo risk"
    elif iob > 1.5:
        risk    = "moderate"  
        message = f"{iob}U insulin still active — monitor closely"
    elif iob > 0.5:
        risk    = "low"
        message = f"{iob}U insulin still active"
    else:
        risk    = "none"
        message = "No significant insulin on board"
    
    return {
        "iob_units":  iob,
        "risk_level": risk,
        "message":    message
    }