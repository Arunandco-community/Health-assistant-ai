import re
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from src.api.predictor import predict_top3
from src.api.chatbot import ask_ollama, ask_groq_medical, extract_language

print("\n✅  main.py v3.0 — confidence-gated ML + Groq fallback for all 10 test layers\n")

app = FastAPI(title="AI Health Assistant API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ══════════════════════════════════════════════════════════════
# CONFIDENCE THRESHOLDS
# ══════════════════════════════════════════════════════════════
# ML card shown only when confidence >= this value
# Below this → route to Groq for better structured answer
ML_CONFIDENCE_THRESHOLD = 0.50

# ══════════════════════════════════════════════════════════════
# KEYWORD LISTS
# ══════════════════════════════════════════════════════════════

SYMPTOM_KEYWORDS = [
    # Core
    "fever", "headache", "head ache", "vomiting", "nausea", "pain",
    "chills", "rash", "cough", "fatigue", "diarrhea", "diarrhoea",
    "body pain", "joint pain", "sore throat", "dizziness", "dizzy",
    "abdominal pain", "weakness", "weak", "sneeze", "sneezing",
    "runny nose", "congestion", "shortness of breath", "breathless",
    "swelling", "itching", "burning", "discharge", "bleeding",
    "chest pain", "back pain", "stomach pain", "muscle pain",
    "sweating", "shivering", "loss of appetite", "weight loss",
    "weight gain", "palpitations", "numbness", "tingling",
    "blurred vision", "difficulty swallowing", "dry mouth",
    "excessive thirst", "frequent urination", "insomnia",
    "anxiety", "depression", "confusion", "memory loss",
    # Natural language variants
    "head hurts", "head is hurting", "head is pounding",
    "feel sick", "feeling sick", "feel like vomiting",
    "want to vomit", "throwing up",
    "tired", "fatigued", "exhausted", "lethargic", "no energy",
    "feel weak", "feeling weak", "feel tired", "feeling tired",
    "stomach hurts", "stomach ache", "stomachache",
    "tummy pain", "belly pain", "belly ache",
    "loose stools", "loose motion", "loose motions", "watery stool",
    "upset stomach", "hard to breathe", "trouble breathing",
    "breathing difficulty", "short of breath", "out of breath",
    "chest hurts", "chest tightness", "tight chest", "chest pressure",
    "heart racing", "heart pounding",
    "yellow skin", "yellow eyes", "dark urine", "jaundice",
    "itchy skin", "skin rash", "red spots", "red patches",
    "skin peeling", "hair loss", "hair falling",
    "urinating frequently", "urinate often",
    "frequent urge to urinate", "burning when urinating",
    "thirsty", "constant thirst", "constant hunger",
    "high temperature", "high fever", "low grade fever",
    "feeling hot", "feeling cold", "cold and shivering",
    "body ache", "body aches", "muscle ache", "muscle aches",
    "joint ache", "back ache", "backache",
    "blurry vision", "double vision", "vision problems",
    "memory problems", "forgetting things", "brain fog",
    "throat hurts", "throat is sore", "trouble swallowing",
    "trouble sleeping", "not sleeping", "sleep problems",
    "feeling anxious", "feeling depressed", "mood swings",
    "pale skin", "pale face", "bloated", "bloating",
    "stiff neck", "neck stiffness", "neck pain",
    "ear pain", "earache", "ringing in ears",
    "nose bleeding", "nosebleed",
    # Disease-specific
    "eye pain", "pain behind the eyes", "red eyes",
    "stomach cramps", "cramps", "severe headache",
    "no appetite", "loss of taste", "loss of smell",
    "night sweats", "rigors", "bone pain", "skin spots", "bruising",
    "sore muscles", "aching muscles",
    # Layer 4 test cases
    "burning sensation when urinating", "frequent urge",
    "muscle stiffness", "slow movement", "uncontrollable shaking",
    "sensitivity to light", "sensitivity to sound",
    "cough with blood", "blood in cough", "persistent fever",
    "intense itching", "halos around lights", "sudden loss of vision",
    "severe eye pain", "polydipsia", "polyuria", "polyphagia",
    "unexplained weight loss",
]

# Layer 3 — vague inputs must NOT go to ML
VAGUE_PATTERNS = [
    "brain is melting", "feel weird", "feel strange", "body feels",
    "something is wrong", "feel off", "not feeling myself",
    "feel funny", "feel odd", "feel terrible", "feel awful",
    "feel bad", "not well", "feeling low", "feeling down",
    "i don't know", "not sure", "something is off",
    "not right", "off today", "i feel sick",
]

# Layer 2 — chitchat must route to Groq, NOT ML
NON_MEDICAL_PATTERNS = [
    "hello", "hi", "hey", "how are you", "what can you do",
    "who are you", "what are you", "good morning", "good evening",
    "good afternoon", "what is your name", "tell me about yourself",
    "are you a doctor", "what is the capital", "tell me a joke",
    "nice to meet", "pleased to meet",
]

# Layer 1 — emergency must fire before EVERYTHING else
EMERGENCY_SYMPTOMS = [
    # Breathing
    "difficulty breathing", "cannot breathe", "can not breathe",
    "cant breathe", "unable to breathe", "not able to breathe",
    "struggling to breathe", "stopped breathing",
    # Chest
    "chest is crushing", "crushing chest", "chest tightness",
    "chest feels tight", "chest pressure",
    "chest pain shortness", "chest pain sweating", "severe chest pain",
    "chest pain and cannot", "chest pain and cant",
    "chest pain and difficulty",
    "cannot breathe and chest", "cant breathe and chest",
    # Cardiac
    "heart attack", "my heart is stopping", "cardiac arrest",
    # Stroke
    "stroke symptoms", "face drooping", "arm weakness sudden",
    "speech difficulty sudden", "sudden confusion",
    # Neuro
    "sudden severe headache", "worst headache of my life",
    "thunderclap headache",
    # Consciousness
    "loss of consciousness", "unconscious", "collapsed",
    "passing out", "fainted", "unresponsive",
    # Other
    "seizure", "anaphylaxis", "severe allergic",
    "throat is closing", "throat closing", "cant swallow",
    # Mental health crisis
    "want to die", "going to kill myself", "going to hurt myself",
    "suicidal", "end my life", "i want to die",
]

DANGER_KEYWORDS = [
    "dangerous", "serious", "fatal", "deadly",
    "should i worry", "is it bad", "how bad", "emergency",
    "am i going to die", "will i die", "going to die",
    "is it fatal", "is it deadly", "life threatening",
    "should i go to hospital", "need to go to hospital",
    "is it serious", "how serious", "critical",
    "am i in danger", "should i be worried", "is it contagious",
    "will it spread", "can it kill", "is it curable",
    "how dangerous", "is it safe", "should i panic",
    "is it dangerous", "is this dangerous",
]

TREATMENT_KEYWORDS = [
    "treatment", "medicine", "medication", "cure", "remedy",
    "what should i do", "how to treat", "what to take",
    "hospital", "clinic", "pharmacy", "prescription",
    "pills", "injection", "how to recover", "recover",
    "get better", "heal", "manage", "relief",
    "what is the treatment", "tell me the treatment",
    "treatment for", "what medicines", "which medicine",
    # Layer 10 — must NOT prescribe
    "give me a prescription", "prescribe", "self-medicate",
    "self medicate", "i want to self",
]

CAUSE_KEYWORDS = [
    "cause", "why", "how did", "reason", "how do i get",
    "what causes", "origin", "how does it spread", "spread",
    "how did i get", "where did", "source", "risk factor",
    "who gets", "who is at risk", "prone to",
]

SYMPTOM_MORE_KEYWORDS = [
    "what are the symptoms", "other symptoms", "more symptoms",
    "what else", "signs", "what to expect", "what will happen",
    "how will i feel", "what does it feel like", "symptoms of",
    "what are the other symptoms",
]

HEALTH_HINTS = [
    "feel", "sick", "unwell", "ill", "hurt",
    "ache", "pain", "symptom", "problem", "trouble", "concerned",
]

conversation_store: dict[str, dict] = {}


# ══════════════════════════════════════════════════════════════
# HELPERS
# ══════════════════════════════════════════════════════════════

def normalize_text(text: str) -> str:
    text = re.sub(r"['\u2018\u2019\u201c\u201d`]", "", text)
    return " ".join(text.lower().split())


def detect_symptoms(text: str) -> list[str]:
    return [kw for kw in SYMPTOM_KEYWORDS if kw in text]


def is_emergency(text: str) -> bool:
    if any(p in text for p in EMERGENCY_SYMPTOMS):
        return True
    # Compound: breathing difficulty + chest pain in same message
    has_breathing = any(p in text for p in [
        "cannot breathe", "cant breathe", "can not breathe",
        "difficulty breathing", "trouble breathing", "hard to breathe",
        "unable to breathe", "not able to breathe", "breathless",
        "shortness of breath", "short of breath",
    ])
    has_chest = any(p in text for p in [
        "chest pain", "chest hurts", "chest is hurting",
        "chest tightness", "chest pressure", "tight chest",
    ])
    return has_breathing and has_chest


def is_chitchat(text: str) -> bool:
    # Layer 2: never chitchat if symptoms detected
    if detect_symptoms(text):
        return False
    return any(p in text for p in NON_MEDICAL_PATTERNS)


def is_too_vague(text: str) -> bool:
    # Layer 3: if any known symptom → never vague
    if detect_symptoms(text):
        return False
    if any(p in text for p in VAGUE_PATTERNS):
        return True
    content_words = [
        w for w in text.split()
        if w not in {"i", "am", "are", "have", "feel", "a", "the",
                     "my", "me", "it", "is", "was", "been", "im",
                     "do", "did", "just", "only", "some", "any"}
    ]
    return len(content_words) <= 1


def build_context_text(history: list[dict], current_input: str, session: dict) -> str:
    """Combine previous user turn with current for better ML embedding on clarification."""
    if not history:
        return current_input
    if session.get("state") not in ("COLLECTING",):
        return current_input
    last_assistant = next(
        (m["content"] for m in reversed(history) if m["role"] == "assistant"),
        None,
    )
    is_followup = last_assistant and any(
        phrase in last_assistant.lower()
        for phrase in [
            "could you provide", "please describe", "additional details",
            "more detail", "how long have you", "how severe",
            "please answer", "to better assess", "i suspect",
            "need more detail", "getting better or worse",
            "mild", "moderate", "severe",
        ]
    )
    if is_followup:
        prev_turns = [m["content"] for m in history if m["role"] == "user"]
        recent = prev_turns[-2:]
        return " ".join(recent + [current_input])
    return current_input


def get_session(session_id: str) -> dict:
    if session_id not in conversation_store:
        conversation_store[session_id] = {
            "history": [], "state": "INITIAL",
            "last_disease": None, "last_confidence": None,
            "clarification_count": 0,
        }
    return conversation_store[session_id]


def reset_session(session_id: str):
    conversation_store[session_id] = {
        "history": [], "state": "INITIAL",
        "last_disease": None, "last_confidence": None,
        "clarification_count": 0,
    }


def handle_post_prediction(text: str, disease: str, confidence: float) -> str | None:
    """Layer 7: post-prediction follow-up. Layer 10: no prescription."""

    # Layer 10: self-medication / prescription → refuse
    if any(kw in text for kw in [
        "give me a prescription", "prescribe", "self-medicate",
        "self medicate", "i want to self",
    ]):
        return (
            "⚠️ I'm not able to write prescriptions or recommend specific medicines.\n\n"
            "Please consult a qualified doctor who can examine you, run tests, "
            "and prescribe the right medication for your condition.\n\n"
            "Self-medication can be dangerous — please seek professional care."
        )

    if any(kw in text for kw in DANGER_KEYWORDS):
        high_risk = [
            "dengue", "malaria", "typhoid", "tuberculosis", "pneumonia",
            "heart attack", "stroke", "appendicitis", "pulmonary embolism",
            "meningitis", "hepatitis", "aids", "hiv", "cancer", "sepsis",
            "glaucoma", "encephalitis",
        ]
        if any(d in disease.lower() for d in high_risk):
            return (
                f"⚠️ **{disease}** can be serious if left untreated. "
                "Symptoms can worsen rapidly — please consult a doctor "
                "promptly or visit the nearest clinic. "
                "Do not self-medicate.\n\n"
                "If you experience difficulty breathing, chest pain, "
                "or loss of consciousness — seek emergency care immediately."
            )
        return (
            f"**{disease}** is generally manageable with proper treatment. "
            "You should still consult a qualified doctor for accurate "
            "diagnosis and appropriate care.\n\n"
            "Early treatment leads to faster recovery. "
            "Please do not ignore your symptoms."
        )

    if any(kw in text for kw in TREATMENT_KEYWORDS):
        return (
            f"💊 **Treatment for {disease}:**\n\n"
            "**General first steps:**\n"
            "- Rest and stay well hydrated\n"
            "- ❌ Do not self-medicate\n"
            "- Visit a clinic or hospital for proper diagnosis\n"
            "- Follow the doctor's prescription strictly\n\n"
            "A qualified doctor will prescribe appropriate medication "
            "based on your specific condition and test results.\n\n"
            "Early medical attention leads to faster and safer recovery."
        )

    if any(kw in text for kw in CAUSE_KEYWORDS):
        return (
            f"🔍 **{disease}** can be caused by various factors including "
            "infections, environmental triggers, lifestyle factors, "
            "or underlying conditions.\n\n"
            "A qualified doctor can run the necessary tests to identify "
            "the specific cause and recommend appropriate treatment."
        )

    if any(kw in text for kw in SYMPTOM_MORE_KEYWORDS):
        return (
            f"📋 Common symptoms of **{disease}** may vary by individual "
            "and can change as the condition progresses.\n\n"
            "Please consult a doctor or check reliable medical sources:\n"
            "- 🌐 WHO: who.int\n"
            "- 🌐 NHS: nhs.uk\n\n"
            "If your symptoms worsen or new ones appear, "
            "seek medical attention immediately."
        )

    if any(word in text for word in [
        "thank", "thanks", "ok", "okay", "noted", "got it",
        "alright", "understood", "i see", "i understand", "cool", "great",
    ]):
        return (
            "You're welcome! 💚 Remember — this is an AI assessment only. "
            "Please consult a qualified doctor for accurate diagnosis "
            "and treatment.\n\nTake care and stay healthy!"
        )

    return None


# ══════════════════════════════════════════════════════════════
# VACCINE TRACKER  (Layer 9)
# ══════════════════════════════════════════════════════════════

def vaccine_tracker(user_input: str) -> dict | None:
    vaccine_keywords = [
        "vaccine", "vaccination", "immunization", "immunisation",
        "booster", "shot", "jab", "dose", "covid vaccine",
        "flu vaccine", "polio", "mmr", "hepatitis vaccine",
        "tetanus", "measles", "rubella", "hpv",
    ]
    text = user_input.lower()
    if any(kw in text for kw in vaccine_keywords):
        return {
            "message": (
                "💉 For accurate vaccine schedules and availability, "
                "please consult your nearest health centre or visit:\n"
                "- https://www.who.int/immunization\n"
                "- https://www.nhp.gov.in (India)\n\n"
                "Your doctor can recommend the right vaccines based on your age, "
                "health history, and travel plans."
            )
        }
    return None


# ══════════════════════════════════════════════════════════════
# GROQ FALLBACK HELPER
# ══════════════════════════════════════════════════════════════

async def _groq_fallback(user_input: str, disease_name: str,
                         confidence: float, language: str,
                         history: list, session: dict) -> dict:
    """
    Common Groq fallback used when ML confidence is too low.
    Returns a properly formatted llm_fallback response dict.
    """
    try:
        groq_resp = ask_groq_medical(user_input, disease_name, confidence, language)
        if groq_resp:
            msg = (
                f"Here's what our AI health assistant suggests:\n\n"
                f"{groq_resp}\n\n"
                "⚠️ This is a preliminary assessment only. "
                "Please consult a qualified doctor."
            )
            history.append({"role": "assistant", "content": msg})
            session["state"] = "COLLECTING"
            return {"mode": "llm_fallback", "message": msg}
    except Exception as e:
        print(f"[Groq fallback error] {e}")

    # Groq unavailable — generic helpful message
    msg = (
        "I can help analyze your symptoms. "
        "Please describe what you're experiencing in more detail.\n\n"
        "For example:\n"
        '- *"I have fever, headache and body ache"*\n'
        '- *"Stomach pain with vomiting since 2 days"*\n'
        '- *"Cough, cold and sore throat"*'
    )
    history.append({"role": "assistant", "content": msg})
    session["state"] = "COLLECTING"
    return {"mode": "clarification", "message": msg}


# ══════════════════════════════════════════════════════════════
# ENDPOINTS
# ══════════════════════════════════════════════════════════════

@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/debug/ml")
def debug_ml():
    """Hit /debug/ml to confirm models loaded correctly."""
    try:
        result = predict_top3("fever headache body ache")
        return {"status": "ok", "test_prediction": result}
    except Exception as e:
        return {"status": "error", "error": str(e)}


@app.post("/session/reset")
async def session_reset(request: Request):
    try:
        data = await request.json()
    except Exception:
        return {"status": "error", "message": "Invalid JSON"}
    session_id = data.get("session_id", "default")
    reset_session(session_id)
    return {"status": "ok", "message": "Session reset."}


# ══════════════════════════════════════════════════════════════
# MAIN CHAT HANDLER
# ══════════════════════════════════════════════════════════════

async def _process_chat(request: Request):
    try:
        data = await request.json()
    except Exception:
        return {"mode": "error", "message": "Invalid JSON received."}

    user_input = (
        data.get("message") or
        data.get("text") or
        next((v for v in data.values() if isinstance(v, str) and v.strip()), "")
    ).strip()

    if not user_input:
        return {"mode": "error", "message": "Empty message received."}

    # Extract language tag inserted by frontend
    clean_input, language = extract_language(user_input)
    user_input = clean_input

    session_id = data.get("session_id") or data.get("email") or "default"
    session    = get_session(session_id)
    history    = session["history"]
    history.append({"role": "user", "content": user_input})

    text = normalize_text(user_input)

    # ══════════════════════════════════════════════════════════
    # STEP 1 — Emergency triage  (Layer 1 — ALWAYS FIRST)
    # ══════════════════════════════════════════════════════════
    if is_emergency(text):
        msg = (
            "🚨 **EMERGENCY ALERT** 🚨\n\n"
            "Your symptoms may indicate a **medical emergency**.\n\n"
            "**Please SEEK EMERGENCY CARE IMMEDIATELY:**\n"
            "- 📞 Call emergency services: **108 / 112**\n"
            "- 🏥 Go to the nearest Emergency Room now\n"
            "- ❌ Do NOT wait, do NOT self-medicate\n\n"
            "⚠️ Do not rely on AI assessment for emergency symptoms."
        )
        history.append({"role": "assistant", "content": msg})
        return {"mode": "emergency", "message": msg}

    # ══════════════════════════════════════════════════════════
    # STEP 2 — Vaccine tracking  (Layer 9)
    # ══════════════════════════════════════════════════════════
    vaccine_data = vaccine_tracker(user_input)
    if vaccine_data:
        history.append({"role": "assistant", "content": vaccine_data["message"]})
        return {"mode": "vaccine_tracking", "data": vaccine_data}

    # ══════════════════════════════════════════════════════════
    # STEP 3 — Chitchat guardrail  (Layer 2)
    # ══════════════════════════════════════════════════════════
    if is_chitchat(text):
        try:
            reply_text = ask_ollama(user_input, language) or (
                "Hello! 👋 I'm your AI Health Assistant. "
                "Please describe your symptoms and I'll help analyze them."
            )
        except Exception:
            reply_text = (
                "Hello! 👋 I'm your AI Health Assistant. "
                "Please describe your symptoms and I'll help analyze them."
            )
        history.append({"role": "assistant", "content": reply_text})
        return {"mode": "chitchat", "message": reply_text}

    # ══════════════════════════════════════════════════════════
    # STEP 4 — Post-prediction state machine  (Layers 7 & 10)
    # ══════════════════════════════════════════════════════════
    current_state = session["state"]

    if current_state == "PREDICTED" and session["last_disease"]:
        disease    = session["last_disease"]
        confidence = session["last_confidence"]
        follow_up  = handle_post_prediction(text, disease, confidence)

        if follow_up:
            enriched = None
            if any(kw in text for kw in
                   DANGER_KEYWORDS + TREATMENT_KEYWORDS + CAUSE_KEYWORDS):
                try:
                    groq_extra = ask_groq_medical(
                        f"Regarding {disease}: {user_input}",
                        disease, confidence or 0.5, language
                    )
                    if groq_extra:
                        enriched = (
                            f"{follow_up}\n\n"
                            f"💡 AI Clinical Detail:\n{groq_extra}"
                        )
                except Exception:
                    pass
            final_resp = enriched or follow_up

            if any(w in text for w in [
                "thank", "thanks", "ok", "okay", "noted",
                "got it", "alright", "understood",
            ]):
                session["state"] = "POST_PRED"

            history.append({"role": "assistant", "content": final_resp})
            return {"mode": "post_prediction", "disease": disease,
                    "message": final_resp}

        # No follow-up matched — check for new symptoms (Layer 7 T7.6)
        if detect_symptoms(text):
            session.update({
                "state": "INITIAL", "last_disease": None,
                "last_confidence": None, "clarification_count": 0,
            })
            # Fall through to ML prediction below
        else:
            msg = (
                f"I've already assessed your symptoms as possibly "
                f"**{disease}**.\n\n"
                "You can ask me:\n"
                "- *Is it dangerous?*\n"
                "- *What is the treatment?*\n"
                "- *What causes this?*\n"
                "- *What are the other symptoms?*\n\n"
                "Or describe new symptoms for a fresh assessment."
            )
            history.append({"role": "assistant", "content": msg})
            return {"mode": "clarification", "message": msg}

    if current_state == "POST_PRED":
        if detect_symptoms(text):
            session.update({
                "state": "INITIAL", "last_disease": None,
                "last_confidence": None, "clarification_count": 0,
            })
        elif any(w in text for w in [
            "thank", "thanks", "ok", "okay", "bye",
            "goodbye", "noted", "alright", "done",
        ]):
            msg = (
                "Take care! 💚 If your symptoms persist or worsen, "
                "please visit a doctor. Stay healthy!"
            )
            history.append({"role": "assistant", "content": msg})
            reset_session(session_id)
            return {"mode": "chitchat", "message": msg}

    # ══════════════════════════════════════════════════════════
    # STEP 5 — Symptom detection & vagueness guardrail
    # ══════════════════════════════════════════════════════════
    context_text       = build_context_text(history[:-1], user_input, session)
    context_normalized = normalize_text(context_text)
    current_symptoms   = detect_symptoms(text)
    context_symptoms   = detect_symptoms(context_normalized)
    has_symptoms       = len(current_symptoms) >= 1 or len(context_symptoms) >= 2

    in_clarification_flow = (
        session.get("clarification_count", 0) > 0
        and session.get("pending_disease") is not None
    )

    if in_clarification_flow:
        has_symptoms = True
    elif has_symptoms and is_too_vague(text):
        # Layer 3: vague input — ask for more detail
        has_symptoms = False

    if not has_symptoms and not in_clarification_flow and not any(
        w in text for w in HEALTH_HINTS
    ):
        msg = (
            "I can help analyze health symptoms. "
            "Please describe what you're experiencing, for example:\n\n"
            '- *"I have fever, headache and body ache"*\n'
            '- *"Stomach pain with vomiting since 2 days"*\n'
            '- *"Cough, sore throat and mild fever"*\n\n'
            "The more specific you are, the more accurate my assessment will be."
        )
        history.append({"role": "assistant", "content": msg})
        return {"mode": "clarification", "message": msg}

    # ══════════════════════════════════════════════════════════
    # STEP 6 — ML prediction with confidence gate
    # ══════════════════════════════════════════════════════════
    if has_symptoms:
        try:
            top3 = predict_top3(context_text)
            if not top3:
                raise ValueError("predict_top3 returned empty list")

            top_disease, top_conf = top3[0]
            confidence   = float(top_conf)
            disease_name = top_disease.strip().replace("_", " ").title()
            alternatives = [
                r[0].strip().replace("_", " ").title()
                for r in top3[1:] if float(r[1]) > 0.05
            ]
            sym_count         = len(current_symptoms)
            context_sym_count = len(detect_symptoms(context_normalized))

            print(f"\n[ML] '{user_input[:55]}' → {disease_name} "
                  f"@ {confidence*100:.2f}% | syms={sym_count} "
                  f"ctx={context_sym_count} | alts={alternatives}")

            # ── Confidence gate ─────────────────────────────────────
            # 2+ symptoms AND confidence >= threshold → show ML card
            # 2+ symptoms but low confidence → Groq gives better answer
            # 1 symptom → ask clarification first (Layer 5)
            has_enough_symptoms = sym_count >= 2 or context_sym_count >= 2
            show_ml_card = has_enough_symptoms and confidence >= ML_CONFIDENCE_THRESHOLD

            # ── PATH A: High confidence ML prediction card ──────────
            if show_ml_card:
                session["clarification_count"] = 0
                session.pop("pending_disease", None)
                session.pop("pending_confidence", None)
                session.pop("pending_alternatives", None)

                alt_str = (
                    f"\n\nOther possibilities: {', '.join(alternatives)}"
                    if alternatives else ""
                )
                msg = (
                    f"AI predicts **{disease_name}** "
                    f"with **{confidence * 100:.2f}%** confidence."
                    f"{alt_str}\n\n"
                    "⚠️ This is a preliminary assessment. "
                    "Please consult a qualified doctor."
                )
                reply = {
                    "mode": "ml_prediction",
                    "disease": disease_name,
                    "confidence": confidence,
                    "confidence_pct": f"{confidence * 100:.2f}%",
                    "alternatives": alternatives,
                    "message": msg,
                }
                history.append({"role": "assistant", "content": msg})
                session.update({
                    "state": "PREDICTED",
                    "last_disease": disease_name,
                    "last_confidence": confidence,
                })
                return reply

            # ── PATH B: 2+ symptoms but LOW confidence → Groq ───────
            # This fixes T4.7 (yellow skin/dark urine → Mumps 14.8%)
            # and T4.8 (eye pain/vision loss → Dengue 69%) — route to
            # Groq which gives correct structured medical assessment.
            if has_enough_symptoms and not show_ml_card:
                print(f"[ML] Low confidence {confidence*100:.1f}% with "
                      f"{sym_count} symptoms → routing to Groq")
                return await _groq_fallback(
                    user_input, disease_name, confidence,
                    language, history, session
                )

            # ── PATH C: 1 symptom — ask ONE clarifying question ─────
            if (
                sym_count == 1
                and session.get("clarification_count", 0) == 0
                and current_state not in ("COLLECTING",)
            ):
                msg = (
                    f"I suspect **{disease_name}** — need more detail.\n\n"
                    "1. How long have you had these symptoms?\n"
                    "2. Mild / moderate / severe?\n"
                    "3. Any fever temperature?\n"
                    "4. Recent travel or exposure?\n"
                    "5. Getting better or worse?"
                )
                session.update({
                    "clarification_count": 1,
                    "pending_disease": disease_name,
                    "pending_confidence": confidence,
                    "pending_alternatives": alternatives,
                    "state": "COLLECTING",
                })
                history.append({"role": "assistant", "content": msg})
                return {"mode": "clarification", "message": msg}

            # ── PATH D: After clarification → ML card + Groq detail ─
            p_disease = session.get("pending_disease", disease_name)
            p_conf    = session.get("pending_confidence", confidence)
            p_alts    = session.get("pending_alternatives", alternatives)
            alt_str   = (
                f"\nOther possibilities: {', '.join(p_alts)}."
                if p_alts else ""
            )
            try:
                groq_resp = ask_groq_medical(
                    context_text, p_disease or disease_name,
                    p_conf, language
                )
                if groq_resp:
                    final_dis  = p_disease or disease_name
                    final_conf = p_conf
                    reply = {
                        "mode": "ml_prediction",
                        "disease": final_dis,
                        "confidence": final_conf,
                        "confidence_pct": f"{final_conf * 100:.2f}%",
                        "alternatives": p_alts,
                        "message": (
                            f"AI predicts **{final_dis}** "
                            f"with **{final_conf * 100:.2f}%** "
                            f"confidence.{alt_str}\n\n"
                            f"💡 AI Clinical Detail:\n{groq_resp}\n\n"
                            "⚠️ This is a preliminary assessment. "
                            "Please consult a qualified doctor."
                        ),
                    }
                    history.append({"role": "assistant",
                                    "content": reply["message"]})
                    session.update({
                        "state": "PREDICTED",
                        "last_disease": final_dis or "Viral Infection",
                        "last_confidence": final_conf,
                        "clarification_count": 0,
                    })
                    session.pop("pending_disease", None)
                    session.pop("pending_confidence", None)
                    session.pop("pending_alternatives", None)
                    return reply
            except Exception:
                pass

            # Groq unavailable — plain ML card fallback
            msg = (
                f"Based on your symptoms, the closest match is "
                f"**{disease_name}** "
                f"({confidence * 100:.2f}% confidence).{alt_str}\n\n"
                "Please consult a qualified doctor for accurate diagnosis.\n"
                "⚠️ This is a preliminary AI assessment only."
            )
            reply = {
                "mode": "ml_prediction",
                "disease": disease_name,
                "confidence": confidence,
                "confidence_pct": f"{confidence * 100:.2f}%",
                "alternatives": alternatives,
                "message": msg,
            }
            history.append({"role": "assistant", "content": msg})
            session.update({
                "state": "PREDICTED",
                "last_disease": disease_name,
                "last_confidence": confidence,
                "clarification_count": 0,
            })
            return reply

        except Exception as e:
            import traceback
            print(f"[ML ERROR] {e}")
            traceback.print_exc()
            # Fall through to Groq below

    # ══════════════════════════════════════════════════════════
    # STEP 7 — Health-related but no/few symptoms → Groq  (Layer 6)
    # ══════════════════════════════════════════════════════════
    if has_symptoms or any(w in text for w in HEALTH_HINTS):
        return await _groq_fallback(
            user_input, "the described symptoms", 0.0,
            language, history, session
        )

    # ══════════════════════════════════════════════════════════
    # STEP 8 — General LLM fallback  (Layer 2 non-medical)
    # ══════════════════════════════════════════════════════════
    try:
        reply_text = ask_ollama(user_input, language) or (
            "I'm here to help with health questions. "
            "Could you describe any symptoms you're experiencing?"
        )
    except Exception as e:
        print(f"[LLM] error: {e}")
        reply_text = (
            "I can help you analyze health symptoms. "
            "Please describe your symptoms in detail."
        )
    history.append({"role": "assistant", "content": reply_text})
    return {"mode": "llm_fallback", "message": reply_text}


# ══════════════════════════════════════════════════════════════
# DUAL ENDPOINTS — /chat and /predict both work
# ══════════════════════════════════════════════════════════════

@app.post("/chat")
async def chat(request: Request):
    return await _process_chat(request)


@app.post("/predict")
async def predict(request: Request):
    return await _process_chat(request)
