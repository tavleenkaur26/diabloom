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
- Uses a two-layer LSTM neural network trained on real CGM data
- Consumes the previous 2 hours of glucose history as input
- Integrates Insulin-on-Board (IOB) as a direct model feature
- Generates personalized risk alerts

### Explainable AI

Predictions are accompanied by explanations rather than being presented as black-box outputs.

Examples:

- Glucose has been falling steadily for the last 30 minutes
- Recent glucose volatility is unusually high
- Historical patterns indicate increased risk at this time of day
- Active insulin from a recent bolus is increasing hypoglycemia risk

SHAP values are used to identify the features that contributed most strongly to each prediction.

### Clinical Evaluation

Clarke Error Grid Analysis: 93.7% Zone A+B (clinically safe predictions), 
Essentially zero Zone E (dangerous) predictions

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

```text
User CGM Data
        ↓
Feature Engineering
(9 physiological + temporal features incl. IOB)
        ↓
LSTM Forecasting Model
(30-min glucose prediction)
        ↓
SHAP Explainability Layer
(feature attribution)
        ↓
Risk Assessment Engine
(threshold + trend + IOB logic)
        ↓
Context Injection Layer
(meal + activity signals)
        ↓
FastAPI Backend
        ↓
Next.js Dashboard
```
---

## Machine Learning Pipeline

### Datasets

Primary: OhioT1DM Dataset (official access, Ohio State University)

- 12 real-world T1D patients (2018 + 2020 releases)
- Automated insulin pump logging — complete bolus records
- ~11,000 CGM readings per patient (8 weeks continuous)

Secondary: D1NAMO Dataset (Zenodo)

- 9 real-world T1D patients
- Used for cross-dataset generalization analysis

Personal: Medtronic MiniMed 780G CareLink Export

- 8,291+ readings, May–June 2026
- Used for qualitative inference and system demonstration

### Feature Engineering

The model learns from 9 engineered features:

| Feature | Description |
|---------|-------------|
| glucose_norm | Glucose normalized to physiological bounds [40–400 mg/dL] |
| delta_1 | Immediate rate of change (5 min) |
| delta_3 | Short-term rate of change (15 min) |
| delta_6 | Medium-term rate of change (30 min) |
| rolling_mean_12 | 1-hour glucose baseline |
| rolling_std_12 | Glucose volatility |
| hour_sin / hour_cos | Cyclic time-of-day encoding (circadian patterns) |
| iob_norm | Insulin-on-Board (triangular decay model, normalized) |

### Model

- Framework: PyTorch
- Architecture: Two-layer LSTM
- Hidden Size: 64
- Dropout: 0.2
- Forecast Horizon: 30 minutes
- Input Window: 24 readings (2 hours)
- Parameters: 54,593

---

## Results

| Metric | Value |
|--------|-------|
| Forecast Horizon | 30 minutes |
| Validation MAE | 20.57 mg/dL |
| RMSE | 29.67 mg/dL |
| Hypoglycemia Direction Accuracy | 97.1% |
| Zone A+B (Clarke Error Grid) | 93.7% |
| Zone E (Dangerous Errors) | 0.03% |
| Patients Trained On | 12 (OhioT1DM, official) |
| Personal CGM Records | 8,291+ (Medtronic 780G, May–June 2026) |

---

## Tech Stack

| Category | Technologies |
|----------|--------------|
| **Machine Learning** | PyTorch · NumPy · Pandas · SHAP |
| **Backend** | FastAPI · Pydantic |
| **Frontend** | Next.js · Tailwind CSS · Recharts |
| **Infrastructure** | Supabase · PostgreSQL |
| **AI Services** | Groq API · Llama 3.1 8B Instant (meal text parsing) · Llama 4 Scout 17B (meal photo recognition) |

---

## Project Structure

```text
diabloom/
├── src/
│   ├── dataset.py
│   ├── model.py
│   ├── explain.py
│   └── database.py
├── data/
│   └── raw/
├── models/
├── notebooks/
│   ├── iob_integration.ipynb
│   └── ohio_training.ipynb
├── results/
└── main.py
```
---

## Run Locally

### Backend

python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload

### Frontend 

cd frontend
npm install
npm run dev

### Environment Variables

GROQ_API_KEY=...
SUPABASE_URL=...
SUPABASE_KEY=...

---

## Disclaimer

DiaBloom is a research and educational project and is not intended for medical decision-making or clinical use.

Always follow guidance from qualified healthcare professionals and approved diabetes management devices.
