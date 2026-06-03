
import torch
import torch.nn as nn

class GlucoseLSTM(nn.Module):
    """
    LSTM model for glucose prediction.
    
    Input:  (batch, 24, 8)  — 24 timesteps, 8 features
    Output: (batch,)        — predicted normalised glucose 30 mins ahead
    """
    def __init__(self, input_size=8, hidden_size=64, 
                 num_layers=2, dropout=0.2):
        super().__init__()
        
        self.lstm = nn.LSTM(
            input_size  = input_size,
            hidden_size = hidden_size,
            num_layers  = num_layers,
            dropout     = dropout,
            batch_first = True        # input shape: (batch, seq, features)
        )
        
        # after LSTM, map hidden state to one prediction
        self.head = nn.Sequential(
            nn.Linear(hidden_size, 32),
            nn.ReLU(),
            nn.Dropout(0.1),
            nn.Linear(32, 1)
        )
    
    def forward(self, x):
        # x shape: (batch, 24, 8)
        lstm_out, _ = self.lstm(x)
        # lstm_out shape: (batch, 24, 64)
        
        # take only last timestep — the final summary
        last = lstm_out[:, -1, :]
        # last shape: (batch, 64)
        
        out = self.head(last)
        # out shape: (batch, 1)
        
        return out.squeeze(1)
        # final shape: (batch,) — matches y shape