# src/dataset.py
# Turns raw D1NAMO CSV files into PyTorch-ready tensors
# This is the foundation everything else builds on

import torch
from torch.utils.data import Dataset
import pandas as pd
import numpy as np
from pathlib import Path

# ── Constants ────────────────────────────────────────────
BASE_PATH = 'data/raw/d1namo/diabetes_subset_pictures-glucose-food-insulin'
PATIENTS   = ['001','002','003','004','005','006','007','008','009']
FEATURES   = ['glucose_norm','delta_1','delta_3','delta_6',
              'rolling_mean_12','rolling_std_12','hour_sin','hour_cos']

# ── Step 1: Load raw CSV ──────────────────────────────────
def load_patient(patient_id):
    path = f'{BASE_PATH}/{patient_id}/glucose.csv'
    df = pd.read_csv(path)
    df = df[df['type'] == 'cgm'].copy()
    df['timestamp'] = pd.to_datetime(df['date'] + ' ' + df['time'])
    df['glucose']   = df['glucose'] * 18          # mmol/L → mg/dL
    df = df[['timestamp','glucose']].sort_values('timestamp').reset_index(drop=True)
    return df

# ── Step 2: Engineer features ─────────────────────────────
def engineer_features(df):
    df = df.copy()
    df['delta_1']  = df['glucose'].diff()
    df['delta_3']  = df['glucose'].diff(3)
    df['delta_6']  = df['glucose'].diff(6)
    df['rolling_mean_12'] = df['glucose'].rolling(12).mean()
    df['rolling_std_12']  = df['glucose'].rolling(12).std()
    df['hour']     = df['timestamp'].dt.hour
    df['hour_sin'] = np.sin(2 * np.pi * df['hour'] / 24)
    df['hour_cos'] = np.cos(2 * np.pi * df['hour'] / 24)
    return df.dropna().reset_index(drop=True)

# ── Step 3: Normalise ─────────────────────────────────────
def normalise(df):
    df = df.copy()
    # normalise glucose to 0-1 range using physiological bounds
    G_MIN, G_MAX = 40, 400
    df['glucose_norm'] = (df['glucose'] - G_MIN) / (G_MAX - G_MIN)
    
    # normalise delta features (can be negative)
    for col in ['delta_1','delta_3','delta_6','rolling_mean_12','rolling_std_12']:
        mean = df[col].mean()
        std  = df[col].std()
        df[col] = (df[col] - mean) / (std + 1e-8)   # +1e-8 avoids div by zero
    return df

# ── Step 4: Create sliding windows ───────────────────────
def create_windows(df, window_size=24, horizon=6):
    """
    window_size: how many past readings (24 = 2 hours)
    horizon:     how far ahead to predict (6 = 30 mins)
    
    returns X shape (n_samples, window_size, n_features)
            y shape (n_samples,)  ← normalised glucose value
    """
    values  = df[FEATURES].values.astype(np.float32)
    targets = df['glucose_norm'].values.astype(np.float32)
    
    X, y = [], []
    for i in range(len(values) - window_size - horizon):
        X.append(values[i : i + window_size])
        y.append(targets[i + window_size + horizon])
    
    return np.array(X), np.array(y)

# ── Step 5: PyTorch Dataset class ────────────────────────
class GlucoseDataset(Dataset):
    """
    Loads all patients, engineers features, creates windows.
    Split: first 80% of each patient's time = train
           last  20%                         = val/test
    """
    def __init__(self, patient_ids=None, split='train',
                 window_size=24, horizon=6, train_ratio=0.8):
        
        if patient_ids is None:
            patient_ids = PATIENTS
        
        all_X, all_y = [], []
        
        for pid in patient_ids:
            try:
                df = load_patient(pid)
                df = engineer_features(df)
                df = normalise(df)
                X, y = create_windows(df, window_size, horizon)
                
                # temporal split — NEVER shuffle time series
                split_idx = int(len(X) * train_ratio)
                if split == 'train':
                    all_X.append(X[:split_idx])
                    all_y.append(y[:split_idx])
                else:
                    all_X.append(X[split_idx:])
                    all_y.append(y[split_idx:])
                    
            except Exception as e:
                print(f"Skipping patient {pid}: {e}")
        
        self.X = torch.tensor(np.concatenate(all_X), dtype=torch.float32)
        self.y = torch.tensor(np.concatenate(all_y), dtype=torch.float32)
        
        print(f"[{split}] X shape: {self.X.shape} | y shape: {self.y.shape}")
    
    def __len__(self):
        return len(self.X)
    
    def __getitem__(self, idx):
        return self.X[idx], self.y[idx]