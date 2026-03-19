import numpy as np
import joblib
from pathlib import Path

# =====================================================
# CONFIG — resolve paths relative to backend/ directory
# =====================================================

BACKEND_DIR = Path(__file__).resolve().parent.parent  # backend/
MODEL_DIR = BACKEND_DIR / "models"
MODEL_PATH = MODEL_DIR / "classifier.pkl"
ENCODER_PATH = MODEL_DIR / "label_encoder.pkl"

EMBED_MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"

# =====================================================
# LAZY LOAD — models loaded only on first request
# =====================================================

_classifier = None
_label_encoder = None
_embed_model = None


def _load_models():
    global _classifier, _label_encoder, _embed_model

    if _classifier is None:
        print(f"📂 Loading classifier from: {MODEL_PATH}")
        _classifier = joblib.load(MODEL_PATH)

    if _label_encoder is None:
        print(f"📂 Loading label encoder from: {ENCODER_PATH}")
        _label_encoder = joblib.load(ENCODER_PATH)

    if _embed_model is None:
        print(f"📦 Loading sentence-transformer model...")
        from sentence_transformers import SentenceTransformer
        _embed_model = SentenceTransformer(EMBED_MODEL_NAME)
        print("✅ All ML models loaded successfully!")


# =====================================================
# PREDICTION FUNCTION
# =====================================================

def predict_top3(text: str):
    """
    Returns top 3 predicted diseases with probabilities.
    """
    if not text or not text.strip():
        return []

    # Load models on first call
    _load_models()

    # Generate embedding
    embedding = _embed_model.encode(
        [text],
        normalize_embeddings=True
    )

    # Get probability distribution
    probs = _classifier.predict_proba(embedding)[0]

    # Sort probabilities descending
    top3_idx = np.argsort(probs)[-3:][::-1]

    top3_labels = _label_encoder.inverse_transform(top3_idx)
    top3_probs = probs[top3_idx]

    results = [
        (str(label), float(prob))
        for label, prob in zip(top3_labels, top3_probs)
    ]

    return results
