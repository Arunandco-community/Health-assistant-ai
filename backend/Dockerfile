FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y gcc g++ && rm -rf /var/lib/apt/lists/*

# Install numpy 1.x first to avoid conflicts
RUN pip install --no-cache-dir "numpy==1.26.4"

# Install CPU-only torch (compatible with sentence-transformers 2.7.0)
RUN pip install --no-cache-dir torch==2.2.2+cpu --index-url https://download.pytorch.org/whl/cpu

# Install remaining requirements
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download the sentence-transformer model during build
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2')"

COPY . .

EXPOSE 8000

CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
