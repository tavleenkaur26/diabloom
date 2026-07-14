# DiaBloom - AI Copilot for Type 1 Diabetes

> Predicting hypoglycemia before it happens.

DiaBloom is an explainable machine learning system for Type 1 Diabetes that forecasts future glucose levels, predicts impending hypoglycemia up to 30 minutes in advance, and provides human-readable explanations for its predictions.

The project combines time-series forecasting, explainable AI, real CGM data, and modern full-stack engineering into a single end-to-end application.

---

## Why DiaBloom?

Continuous Glucose Monitors (CGMs) typically alert users after glucose levels have already become dangerous.

For people living with Type 1 Diabetes, the more valuable question is:

"Where will my glucose be in 30 minutes?"

DiaBloom attempts to answer that question by learning patterns from historical glucose data and generating early warnings before a potential hypoglycemic event occurs.

---

## Core Capabilities

### Glucose Forecasting

- Predicts glucose levels 30 minutes into the future
- Uses an LSTM neural network trained on continuous glucose monitoring data
- Consumes the previous 2 hours of glucose history as input
- Generates personalized risk alerts

### Explainable AI

Predictions are accompanied by explanations rather than being presented as black-box outputs.

Examples:

- Glucose has been falling steadily for the last 30 minutes
- Recent glucose volatility is unusually high
- Historical patterns indicate increased risk at this time of day

SHAP values are used to identify the features that contributed most strongly to each prediction.

### Personal Data Integration

- Supports Medtronic MiniMed 780G CareLink exports
- Processes real Guardian 4 CGM readings
- Stores readings and prediction history in PostgreSQL through Supabase

### Meal Intelligence

Users can describe meals in natural language.

Example:

> "2 rotis, dal, rice and a glass of milk"

The system uses a large language model to estimate:

- Carbohydrates
- Glycemic index
- Protein
- Fat
- Expected glucose impact

---

## Architecture

User CGM Data
↓
Feature Engineering
↓
LSTM Forecasting Model
↓
SHAP Explainability Layer
↓
Risk Assessment Engine
↓
FastAPI Backend
↓
Next.js Dashboard

---

## Machine Learning Pipeline

### Dataset

- D1NAMO Type 1 Diabetes Dataset
- 9 real-world T1D patients
- Continuous glucose monitoring records
- Meal and insulin event data

### Feature Engineering

The model learns from engineered features including:

- Current glucose level
- Short-term glucose deltas
- Long-term glucose deltas
- Rolling averages
- Rolling volatility
- Cyclical time-of-day encoding

### Model

- Framework: PyTorch
- Architecture: Two-layer LSTM
- Hidden Size: 64
- Forecast Horizon: 30 minutes
- Input Window: 24 readings (2 hours)

---

## Results

| Metric | Value |
|----------|----------|
| Forecast Horizon | 30 minutes |
| Validation MAE | 18.5 mg/dL |
| Hypoglycemia Direction Accuracy | 94.4% |
| Patients Trained On | 9 |
| Personal CGM Records | 8,291+ (Medtronic 780G,May-June 2026) |

---

## Tech Stack

### Machine Learning

- PyTorch
- NumPy
- Pandas
- SHAP

### Backend

- FastAPI
- Pydantic

### Frontend

- Next.js
- Tailwind CSS
- Recharts

### Infrastructure

- Supabase
- PostgreSQL

### AI Services

- Groq API
- Llama 3.1 8B Instant (meal text parsing)
- GPT-OSS 120B (meal photo recognition)

---

## Project Structure

text diabloom/ ├── src/ │   ├── dataset.py │   ├── model.py │   ├── explain.py │   └── database.py ├── data/ │   └── raw/ ├── models/ ├── frontend/ ├── notebooks/ └── main.py 

---

## Run Locally

### Backend

bash python -m venv venv source venv/bin/activate  pip install -r requirements.txt  uvicorn main:app --reload 

### Frontend

bash cd frontend  npm install npm run dev 

### Environment Variables

env GROQ_API_KEY=... SUPABASE_URL=... SUPABASE_KEY=... 

---

## Disclaimer

DiaBloom is a research and educational project and is not intended for medical decision-making or clinical use.

Always follow guidance from qualified healthcare professionals and approved diabetes management devices.
