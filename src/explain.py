# takes a trained model + one glucose window- returns plain english explanation of the prediction
# translator b/w lstm brain and human user

import torch
import numpy as np
import shap
import sys
sys.path.append('.')

from src.model import GlucoseLSTM

# feature names matching FEATURES list in dataset.py
FEATURE_NAMES = [
    'glucose',      # current normalised glucose
    'delta_1',      # change last 5 mins
    'delta_3',      # change last 15 mins
    'delta_6',      # change last 30 mins
    'rolling_mean', # 1hr average
    'rolling_std',  # 1hr volatility
    'hour_sin',     # time of day (cyclic)
    'hour_cos'      # time of day (cyclic)
]

G_MIN, G_MAX = 40, 400

def denormalise(value):
    return float(value) * (G_MAX - G_MIN) + G_MIN

def predict_glucose(model, window):
    """
    window: numpy array shape (24, 8) — one 2-hour window
    returns: predicted glucose in mg/dL
    """
    model.eval()
    x = torch.tensor(window, dtype=torch.float32).unsqueeze(0)  # (1, 24, 8)
    with torch.no_grad():
        pred_norm = model(x).item()
    return denormalise(pred_norm)

def get_feature_importance(model, window, background_data):
    """
    window:          numpy (24, 8)
    background_data: numpy (n, 24, 8)
    """
    model.eval()
    
    # flatten 3D → 2D for SHAP: (n, 24*8) = (n, 192)
    bg_flat     = background_data[:50].reshape(50, -1)      # (50, 192)
    window_flat = window.flatten()[np.newaxis, :]            # (1, 192)
    
    # wrapper: receives 2D (n, 192), reshapes to 3D, runs model
    def model_fn(x_flat):
        x_3d   = x_flat.reshape(-1, 24, 8)
        tensor = torch.tensor(x_3d, dtype=torch.float32)
        with torch.no_grad(): # no computation of gradients - prediction only, no training
            return model(tensor).numpy()
    
    explainer   = shap.KernelExplainer(model_fn, bg_flat)
    shap_values = explainer.shap_values(window_flat, nsamples=100)
    
    # shap_values shape: (1, 192) → reshape to (24, 8)
    shap_2d          = shap_values[0].reshape(24, 8)
    mean_importance  = np.abs(shap_2d).mean(axis=0)   # (8,) — one value per feature
    
    return dict(zip(FEATURE_NAMES, mean_importance))
    
    # wrap model for SHAP - needs numpy in, numpy out
    def model_fn(x): # past 2hrs -> lstm memory-> detect pattern -> future glucose 
        tensor = torch.tensor(x, dtype=torch.float32)
        with torch.no_grad():
            return model(tensor).numpy()
    
    # use a small background sample (50 samples is enough)
    bg = background_data[:50]
    
    explainer   = shap.KernelExplainer(model_fn, bg) # whyprediction happened
    shap_values = explainer.shap_values(
                    window[np.newaxis, :],   # (1, 24, 8)
                    nsamples=100
                  )
    
    # shap_values shape: (1, 24, 8)
    # average absolute importance across 24 timesteps for each feature
    mean_importance = np.abs(shap_values[0]).mean(axis=0)  # (8,)
    
    return dict(zip(FEATURE_NAMES, mean_importance))

# SHAP - which feature contributes most?

def generate_alert(predicted_glucose, feature_importance, threshold=95):
    """
    Converts prediction + SHAP into a human readable alert.
    threshold=95 gives a safety buffer above the clinical 70 hypo line.
    
    returns: alert dict with level, message, explanation
    """
    # sort features by importance
    ranked = sorted(feature_importance.items(), 
                   key=lambda x: x[1], reverse=True)
    top_features = [f for f, _ in ranked[:3]]
    
    # build explanation from top features
    reasons = []
    if 'delta_6' in top_features:
        reasons.append("your glucose has been dropping steadily for 30+ minutes")
    if 'delta_3' in top_features:
        reasons.append("your glucose dropped sharply in the last 15 minutes")
    if 'delta_1' in top_features:
        reasons.append("your glucose is falling fast right now")
    if 'rolling_mean' in top_features:
        reasons.append("your recent average has been trending low")
    if 'hour_sin' in top_features or 'hour_cos' in top_features:
        reasons.append("this is a high-risk time of day for you")
    if 'rolling_std' in top_features:
        reasons.append("your glucose has been unusually volatile")

    # determine alert level
    if predicted_glucose < 70:
        level = "CRITICAL"
        opener = "⛔ Hypo predicted in ~30 mins"
    elif predicted_glucose < threshold:
        level = "WARNING"
        opener = "⚠️ Glucose heading low in ~30 mins"
    else:
        level = "OK"
        return {
            "level": "OK",
            "predicted_glucose": round(predicted_glucose, 1),
            "message": "Glucose looks stable",
            "explanation": None
        }
    
    reason_text = " and ".join(reasons[:2]) if reasons else "recent glucose patterns"
    
    return {
        "level":             level,
        "predicted_glucose": round(predicted_glucose, 1),
        "message":           f"{opener} — predicted {predicted_glucose:.0f} mg/dL",
        "explanation":       f"Likely because {reason_text}.",
        "top_features":      top_features,
        "feature_importance": {k: round(float(v), 4) for k, v in ranked}
    }