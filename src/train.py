
# training loop for GlucoseLSTM

import torch
import torch.nn as nn
from torch.utils.data import DataLoader
import numpy as np
import os
import sys
sys.path.append('.')

from src.dataset import GlucoseDataset
from src.model import GlucoseLSTM

# config
BATCH_SIZE  = 32
EPOCHS      = 50
LR          = 1e-3      # learning rate
HIDDEN_SIZE = 64
NUM_LAYERS  = 2
WINDOW_SIZE = 24        # 2 hours of past readings
HORIZON     = 6         # predict 30 mins ahead
SAVE_PATH   = 'models/glucose_lstm.pt'

def denormalise(value):
    """convert normalised 0-1 prediction back to mg/dL"""
    G_MIN, G_MAX = 40, 400
    return value * (G_MAX - G_MIN) + G_MIN

def train():
    # data
    print("Loading data...")
    train_ds = GlucoseDataset(split='train', window_size=WINDOW_SIZE, horizon=HORIZON)
    val_ds   = GlucoseDataset(split='val',   window_size=WINDOW_SIZE, horizon=HORIZON)
    
    train_dl = DataLoader(train_ds, batch_size=BATCH_SIZE, shuffle=True)
    val_dl   = DataLoader(val_ds,   batch_size=BATCH_SIZE, shuffle=False)
    
    # model
    model     = GlucoseLSTM(hidden_size=HIDDEN_SIZE, num_layers=NUM_LAYERS)
    loss_fn   = nn.MSELoss()       # mean squared error
    optimizer = torch.optim.Adam(model.parameters(), lr=LR)
    scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(
                optimizer, patience=5, factor=0.5)
    
    print(f"\nModel parameters: {sum(p.numel() for p in model.parameters()):,}")
    print(f"Training samples: {len(train_ds)}")
    print(f"Validation samples: {len(val_ds)}")
    print(f"\nStarting training for {EPOCHS} epochs...\n")
    print(f"{'Epoch':>6} | {'Train Loss':>10} | {'Val Loss':>10} | {'Val MAE (mg/dL)':>15}")
    print("-" * 50)
    
    best_val_loss = float('inf')
    train_losses, val_losses = [], []
    
    for epoch in range(1, EPOCHS + 1):
        
        # training phase
        model.train()
        train_loss = 0
        
        for X_batch, y_batch in train_dl:
            # 1. forward pass
            predictions = model(X_batch)
            
            # 2. compute loss
            loss = loss_fn(predictions, y_batch)
            
            # 3. zero gradients
            optimizer.zero_grad()
            
            # 4. backward pass
            loss.backward()
            
            # 5. update weights
            optimizer.step()
            
            train_loss += loss.item()
        
        train_loss /= len(train_dl)
        
        # validation phase
        model.eval()
        val_loss = 0
        val_mae  = 0
        
        with torch.no_grad():    # dont compute gradients during validation
            for X_batch, y_batch in val_dl:
                predictions = model(X_batch)
                val_loss   += loss_fn(predictions, y_batch).item()
                
                # convert back to mg/dL for interpretable MAE
                pred_mgdl   = denormalise(predictions)
                target_mgdl = denormalise(y_batch)
                val_mae    += torch.mean(torch.abs(pred_mgdl - target_mgdl)).item()
        
        val_loss /= len(val_dl)
        val_mae  /= len(val_dl)
        
        train_losses.append(train_loss)
        val_losses.append(val_loss)
        
        # adjust learning rate if val_loss plateaus
        scheduler.step(val_loss)
        
        # save best model
        if val_loss < best_val_loss:
            best_val_loss = val_loss
            os.makedirs('models', exist_ok=True)
            torch.save(model.state_dict(), SAVE_PATH)
            saved = "✓ saved"
        else:
            saved = ""
        
        # print every epoch
        print(f"{epoch:>6} | {train_loss:>10.4f} | {val_loss:>10.4f} | "
              f"{val_mae:>12.1f} mg/dL  {saved}")
    
    print(f"\nTraining complete. Best val loss: {best_val_loss:.4f}")
    print(f"Model saved to {SAVE_PATH}")
    return train_losses, val_losses

if __name__ == '__main__':
    train_losses, val_losses = train()