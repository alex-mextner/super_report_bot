FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies (core libs for inference)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install FlagEmbedding without deps (we already have the core deps above)
# This avoids pulling in beir/zlib-state which fail on ARM
RUN pip install --no-cache-dir --no-deps FlagEmbedding>=1.2.0

# Model (~2.2GB) will be downloaded on first run
# Or mount a volume to /root/.cache/huggingface for persistence

# Copy server code
COPY server.py .

# Environment variables
ENV PORT=8080
ENV MAX_BATCH_SIZE=32

EXPOSE 8080

# Run with gunicorn for production
CMD ["gunicorn", "--bind", "0.0.0.0:8080", "--workers", "1", "--timeout", "120", "server:app"]
