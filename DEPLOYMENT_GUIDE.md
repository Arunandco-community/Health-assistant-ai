# AI Health Assistant — Complete Deployment Guide
# Web App (Railway) + Android APK (Android Studio)
# =====================================================

==============================================================================
SECTION 1 — FILES TO UPLOAD TO GITHUB
==============================================================================

INCLUDE these files/folders:
✅ server.js
✅ index.html  (in root — served by Node.js)
✅ package.json
✅ package-lock.json
✅ .gitignore
✅ requirements.txt
✅ runtime.txt
✅ railway.toml
✅ Procfile
✅ capacitor.config.json
✅ src/
    ✅ src/api/main.py
    ✅ src/api/chatbot.py
    ✅ src/api/predictor.py
    ✅ src/api/__init__.py
    ✅ src/models_saved/universal_disease_model/classifier.pkl
    ✅ src/models_saved/universal_disease_model/label_encoder.pkl
✅ www/  (if Capacitor uses this folder for the web build)

EXCLUDE (already in .gitignore):
❌ node_modules/
❌ android/app/build/
❌ android/.gradle/
❌ .env  (secrets — never commit)
❌ __pycache__/
❌ .venv/

NOTE ON MODEL FILES:
If classifier.pkl or label_encoder.pkl > 100MB:
  → Use Git LFS: git lfs track "*.pkl"
  → Or upload models to Google Drive and download at startup


==============================================================================
SECTION 2 — GITHUB SETUP
==============================================================================

Step 1: Create GitHub repository
  → Go to https://github.com/new
  → Name: ai-health-assistant
  → Set to Private (your project contains API keys in Railway, not GitHub)
  → Click "Create repository"

Step 2: Push your code
  Open CMD in C:\Users\ELCOT\Documents\ai-health-assistant\ and run:

    git init
    git add .
    git commit -m "Initial commit — AI Health Assistant"
    git branch -M main
    git remote add origin https://github.com/YOUR_USERNAME/ai-health-assistant.git
    git push -u origin main

  → Replace YOUR_USERNAME with your actual GitHub username


==============================================================================
SECTION 3 — RAILWAY DEPLOYMENT (2 Services)
==============================================================================

Your app needs 2 Railway services:
  Service 1: Node.js (frontend + API proxy) → serves index.html + /api/*
  Service 2: Python FastAPI (ML backend) → runs on internal Railway URL

--- SERVICE 1: Node.js Web App ---

Step 1: Go to https://railway.app → Login with GitHub

Step 2: Click "New Project" → "Deploy from GitHub repo"
  → Select your ai-health-assistant repo

Step 3: Railway auto-detects Node.js. Click "Deploy Now"

Step 4: Add environment variables (Settings → Variables):
  PORT=3000
  MONGO_URI=mongodb+srv://aihealth:aihealth123@cluster0.l8fto.mongodb.net/ai_health_assistant?retryWrites=true&w=majority
  GROQ_API_KEY=gsk_your_actual_groq_key
  EMAIL_USER=your-email@gmail.com
  EMAIL_PASSWORD=your-gmail-app-password
  EMAIL_HOST=smtp.gmail.com
  EMAIL_PORT=587
  AI_BACKEND_URL=https://YOUR-PYTHON-SERVICE.railway.app
  (fill this after Service 2 is deployed)

Step 5: Click "Generate Domain" under Settings → Networking
  → You get: https://web-production-XXXXX.up.railway.app
  → This is your web app URL

--- SERVICE 2: Python ML Backend ---

Step 1: In your Railway project → "Add Service" → "GitHub Repo"
  → Select same ai-health-assistant repo

Step 2: Override the start command:
  Settings → Deploy → Start Command:
    python -m uvicorn src.api.main:app --host 0.0.0.0 --port $PORT

Step 3: Add environment variables:
  GROQ_API_KEY=gsk_your_actual_groq_key

Step 4: Generate a domain for the Python service
  → Copy the URL e.g. https://ai-health-python-XXXXX.railway.app

Step 5: Go back to Service 1 (Node.js) → Variables
  → Update AI_BACKEND_URL = https://ai-health-python-XXXXX.railway.app

Step 6: Redeploy Service 1


==============================================================================
SECTION 4 — VERIFY DEPLOYMENT
==============================================================================

Test these URLs after deployment:

1. Web app loads:
   https://your-web-app.railway.app/

2. Python ML health check:
   https://your-python-service.railway.app/health
   → Should return: {"status": "ok"}

3. ML model loaded:
   https://your-python-service.railway.app/debug/ml
   → Should return top 3 predictions for "fever headache body ache"

4. Full chat test:
   Open web app → type "I have fever, chills, sweating and muscle pain"
   → Should show ML PREDICTION card with disease + confidence bar


==============================================================================
SECTION 5 — ANDROID APK (Mobile App)
==============================================================================

Your project already has Capacitor configured. Follow these steps:

--- STEP A: Build web app for mobile ---

Step 1: Make sure index.html points to your Railway URL
  Open index.html → Find this line:
    let AI_API = window.location.origin + '/api/ai/predict';
  → This is correct — it auto-detects the host, works for both web and mobile

Step 2: Copy web files to Capacitor www folder
  (If index.html is in root, it should already be in www/)
  If not: copy index.html to www/index.html

--- STEP B: Sync Capacitor ---

Open CMD in project root:
  npx cap sync android

--- STEP C: Build APK in Android Studio ---

Step 1: Open Android Studio
  npx cap open android

Step 2: Wait for Gradle sync to finish

Step 3: Update API URL in capacitor.config.json or in the app:
  The app uses window.location.origin — for mobile, this won't work
  
  IMPORTANT FIX for mobile:
  Open index.html → Find:
    let AI_API = window.location.origin + '/api/ai/predict';
  
  Change to:
    const RAILWAY_URL = 'https://your-web-app.railway.app';
    let AI_API = (window.location.hostname === 'localhost' || 
                  window.location.protocol === 'file:')
                 ? RAILWAY_URL + '/api/ai/predict'
                 : window.location.origin + '/api/ai/predict';

Step 4: Build APK
  Android Studio → Build → Build Bundle(s)/APK(s) → Build APK(s)
  
  APK location:
  android/app/build/outputs/apk/debug/app-debug.apk

Step 5: Install on phone
  → Transfer APK to phone
  → Enable "Install from unknown sources" in phone settings
  → Tap APK to install

--- STEP D: Production-signed APK (for Play Store) ---

Android Studio → Build → Generate Signed Bundle/APK
  → Select APK
  → Create new keystore or use existing
  → Build Release APK
  → APK: android/app/build/outputs/apk/release/app-release.apk


==============================================================================
SECTION 6 — ENVIRONMENT VARIABLES REFERENCE
==============================================================================

Node.js Service (Railway):
  PORT                = 3000
  MONGO_URI           = mongodb+srv://... (your Atlas connection string)
  GROQ_API_KEY        = gsk_...
  AI_BACKEND_URL      = https://your-python-service.railway.app
  EMAIL_USER          = your@gmail.com
  EMAIL_PASSWORD      = xxxx xxxx xxxx xxxx  (Gmail App Password)
  EMAIL_HOST          = smtp.gmail.com
  EMAIL_PORT          = 587

Python Service (Railway):
  GROQ_API_KEY        = gsk_...  (same key)

Local Development (.env file — DO NOT commit):
  PORT=3000
  MONGO_URI=mongodb+srv://...
  GROQ_API_KEY=gsk_...
  AI_BACKEND_URL=http://localhost:8000
  EMAIL_USER=your@gmail.com
  EMAIL_PASSWORD=your-app-password


==============================================================================
SECTION 7 — CHECKLIST BEFORE DEPLOYING
==============================================================================

[ ] All test cases passing locally (run TEST_PROMPTS.md tests)
[ ] classifier.pkl exists at src/models_saved/universal_disease_model/
[ ] label_encoder.pkl exists at src/models_saved/universal_disease_model/
[ ] .env is in .gitignore (never committed)
[ ] package.json has correct "start": "node server.js"
[ ] requirements.txt has all Python packages
[ ] Both Railway services have GROQ_API_KEY set
[ ] Node.js service has AI_BACKEND_URL pointing to Python service
[ ] Python service /health returns {"status":"ok"}
[ ] Python service /debug/ml returns predictions
[ ] Web app URL loads and chat works


==============================================================================
CONTINUATION PROMPT FOR NEW CHAT
==============================================================================

Copy this into a new Claude chat:

---
I'm deploying an AI Health Assistant web app to Railway (cloud).

PROJECT STRUCTURE:
- Node.js Express (server.js) on port 3000 — serves index.html + /api/* routes
- Python FastAPI (src/api/main.py) on port 8000 — ML predictions via /predict
- server.js proxies /api/ai/predict → Python backend (AI_BACKEND_URL env var)
- MongoDB Atlas for user/vaccine data
- Groq LLaMA API for medical chat

WHAT'S WORKING LOCALLY:
- All 10 test layers pass (emergency, chitchat, ML prediction, post-prediction)
- ML card shows for 2+ symptoms (show_ml_card = sym_count >= 2)
- Models at: src/models_saved/universal_disease_model/classifier.pkl
- Predictor path: src/api/predictor.py (parent.parent.parent = project root)

RAILWAY SETUP (2 services):
- Service 1: Node.js → runs "node server.js"
- Service 2: Python → runs "python -m uvicorn src.api.main:app --host 0.0.0.0 --port $PORT"
- Service 1 has env var: AI_BACKEND_URL = https://python-service.railway.app

ANDROID (Capacitor):
- Already built APK using Android Studio
- Need to update API URL for mobile: window.location.origin doesn't work on Capacitor

CURRENT ISSUE: [describe what's wrong]

Files I'll upload: main.py, chatbot.py, predictor.py, server.js, index.html
---
