FROM python:3.12-slim

# ffmpeg on PATH takes precedence over the imageio-ffmpeg fallback in
# server/downloads.py, so builds are deterministic and start instantly
# instead of downloading a binary on first request.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY server/requirements.txt server/requirements.txt
RUN pip install --no-cache-dir -r server/requirements.txt

COPY server server

EXPOSE 8000
CMD ["python", "-m", "uvicorn", "server.main:app", "--host", "0.0.0.0", "--port", "8000"]
