FROM python:3.12-slim

WORKDIR /app

# LOCAL_MODELS=1 adds on-box Whisper/Coqui (~3GB). Default 0: voice runs on ElevenLabs.
ARG LOCAL_MODELS=0

COPY requirements.txt requirements-local.txt ./
RUN pip install --no-cache-dir --timeout 120 --retries 10 -r requirements.txt

RUN if [ "$LOCAL_MODELS" = "1" ]; then \
        apt-get update \
        && apt-get install -y --no-install-recommends ffmpeg libgomp1 libsndfile1 espeak-ng \
        && rm -rf /var/lib/apt/lists/* \
        && pip install --no-cache-dir --timeout 120 --retries 10 -r requirements-local.txt; \
    fi

COPY . .

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
