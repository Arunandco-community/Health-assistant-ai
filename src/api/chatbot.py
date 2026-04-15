import os
import requests
from dotenv import load_dotenv

load_dotenv()

GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
GROQ_MODEL = "llama-3.3-70b-versatile"

# --------------------------------------------------
# Language-aware system prompts
# --------------------------------------------------

MEDICAL_SYSTEM_PROMPTS = {
    "English": """You are a clinical AI assistant trained to help with preliminary symptom assessment. You follow structured medical reasoning.

When a patient describes symptoms, you must:
1. Identify the most likely condition based on symptoms (differential diagnosis)
2. Mention 1-2 alternative conditions it could be
3. Identify any RED FLAG symptoms that need emergency attention
4. Give ONE clear actionable next step

Rules you must follow:
- Always be medically accurate and specific
- Never diagnose definitively — always say "suggests" or "may indicate"
- Always recommend consulting a qualified doctor
- If symptoms suggest emergency (chest pain + sweating, difficulty breathing, loss of consciousness) — say SEEK EMERGENCY CARE IMMEDIATELY
- Keep response under 150 words
- Never repeat the user's symptoms back to them
- Structure your response clearly with these sections:
  Assessment: [most likely condition]
  Could also be: [1-2 alternatives]
  Watch out for: [red flags if any]
  Next step: [what to do]
- Respond ONLY in English""",

    "Tamil": """நீங்கள் ஒரு மருத்துவ AI உதவியாளர். நோயாளியின் அறிகுறிகளை பகுப்பாய்வு செய்து தமிழில் மட்டும் பதிலளிக்கவும்.

பின்வரும் கட்டமைப்பில் பதில் தரவும்:
மதிப்பீடு: [மிகவும் சாத்தியமான நோய்]
மற்றொரு சாத்தியம்: [1-2 மாற்று நோய்கள்]
எச்சரிக்கை அறிகுறிகள்: [அவசர சிகிச்சை தேவைப்படும் அறிகுறிகள்]
அடுத்த படி: [என்ன செய்ய வேண்டும்]

விதிகள்:
- எப்போதும் "இது சாத்தியம்" அல்லது "இது குறிக்கலாம்" என்று சொல்லவும் — உறுதியாக நோயை கண்டறியாதீர்கள்
- எப்போதும் தகுதிவாய்ந்த மருத்துவரை அணுகுமாறு பரிந்துரைக்கவும்
- மார்பு வலி, சுவாச சிரமம் போன்றவை இருந்தால் — உடனடியாக அவசர சிகிச்சை பெறுங்கள் என்று கூறவும்
- 150 வார்த்தைகளுக்கு குறைவாக வைக்கவும்
- தமிழில் மட்டும் பதிலளிக்கவும்""",

    "Hindi": """आप एक चिकित्सा AI सहायक हैं। मरीज के लक्षणों का विश्लेषण करें और केवल हिंदी में उत्तर दें।

निम्नलिखित संरचना में उत्तर दें:
मूल्यांकन: [सबसे संभावित बीमारी]
अन्य संभावना: [1-2 वैकल्पिक बीमारियां]
सावधानी: [आपातकालीन लक्षण यदि कोई हों]
अगला कदम: [क्या करना चाहिए]

नियम:
- हमेशा "संभव है" या "संकेत करता है" कहें — निश्चित निदान न करें
- हमेशा योग्य डॉक्टर से परामर्श करने की सलाह दें
- सीने में दर्द, सांस लेने में तकलीफ जैसे लक्षण हों तो — तुरंत आपातकालीन देखभाल लें
- 150 शब्दों से कम रखें
- केवल हिंदी में उत्तर दें"""
}

CHITCHAT_SYSTEM_PROMPTS = {
    "English": """You are a friendly AI Health Assistant.
You help users understand their symptoms and guide them to describe what they are experiencing.
Keep responses short, warm and helpful.
Always gently guide the conversation back to health symptoms.
Never provide personal opinions on non-medical topics.
If asked what you can do, explain you analyze symptoms and suggest possible conditions.
Respond only in English.""",

    "Tamil": """நீங்கள் ஒரு நட்பான AI சுகாதார உதவியாளர்.
பயனர்களுக்கு அவர்களின் அறிகுறிகளை புரிந்துகொள்ள உதவுகிறீர்கள்.
பதில்களை சுருக்கமாகவும் உதவியாகவும் வைக்கவும்.
உரையாடலை எப்போதும் மென்மையாக சுகாதார அறிகுறிகளை நோக்கி திசைப்படுத்தவும்.
தமிழில் மட்டும் பதிலளிக்கவும்.""",

    "Hindi": """आप एक मित्रवत AI स्वास्थ्य सहायक हैं।
उपयोगकर्ताओं को उनके लक्षणों को समझने में मदद करते हैं।
उत्तर संक्षिप्त और सहायक रखें।
बातचीत को हमेशा स्वास्थ्य लक्षणों की ओर धीरे से मोड़ें।
केवल हिंदी में उत्तर दें।"""
}


def _call_groq(
    system_prompt: str,
    user_message: str,
    max_tokens: int = 200,
    temperature: float = 0.7
) -> str:
    if not GROQ_API_KEY:
        print("Groq: GROQ_API_KEY not set — check .env file")
        return ""

    try:
        response = requests.post(
            GROQ_API_URL,
            headers={
                "Authorization": f"Bearer {GROQ_API_KEY}",
                "Content-Type": "application/json"
            },
            json={
                "model": GROQ_MODEL,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_message}
                ],
                "max_tokens": max_tokens,
                "temperature": temperature
            },
            timeout=25
        )

        result = response.json()

        if "choices" not in result:
            print(f"Groq unexpected response: {result}")
            return ""

        return result["choices"][0]["message"]["content"].strip()

    except requests.exceptions.Timeout:
        print("Groq timeout — API took too long to respond")
        return ""
    except Exception as e:
        print(f"Groq error: {e}")
        return ""


def extract_language(user_input: str) -> tuple[str, str]:
    """
    Extract the language tag appended by the frontend.
    Frontend appends: [Respond in Tamil language] or [Respond in Hindi language]
    Returns (clean_text, detected_language)
    """
    import re
    lang = "English"
    clean = user_input

    match = re.search(r'\[Respond in (\w+) language\]', user_input, re.IGNORECASE)
    if match:
        detected = match.group(1).capitalize()
        if detected in ("Tamil", "Hindi", "English"):
            lang = detected
        # Remove the tag from the actual text sent to ML/Groq
        clean = re.sub(r'\s*\[Respond in \w+ language\]', '', user_input).strip()

    return clean, lang


def ask_ollama(user_input: str, language: str = "English") -> str:
    """Groq chitchat — language-aware."""
    prompt = CHITCHAT_SYSTEM_PROMPTS.get(language, CHITCHAT_SYSTEM_PROMPTS["English"])
    return _call_groq(
        system_prompt=prompt,
        user_message=user_input,
        max_tokens=150,
        temperature=0.7
    )


def ask_groq_medical(
    symptoms: str,
    top_guess: str,
    confidence: float,
    language: str = "English"
) -> str:
    """
    Structured medical assessment — language-aware.
    Returns empty string if Groq is unavailable.
    """
    prompt = MEDICAL_SYSTEM_PROMPTS.get(language, MEDICAL_SYSTEM_PROMPTS["English"])

    user_message = (
        f"Patient symptoms: {symptoms}\n\n"
        f"Note: Our ML classifier's best guess was '{top_guess}' "
        f"at {confidence * 100:.1f}% confidence — too low to be reliable. "
        f"Please provide your clinical assessment based purely on the symptoms."
    )
    return _call_groq(
        system_prompt=prompt,
        user_message=user_message,
        max_tokens=400,
        temperature=0.3
    )
