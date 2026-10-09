FROM python:3.12-slim

# ffmpeg on PATH takes precedence over the imageio-ffmpeg fallback in
# downloads.py, so the image starts instantly with no runtime download.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
# yt-dlp runs YouTube's player JavaScript with deno; without it formats can go missing.
COPY --from=denoland/deno:bin-2.5.6 /deno /usr/local/bin/deno

WORKDIR /app
# Copied into app/server (not flattened into /app) so the package's own
# relative imports (`from .database import ...`) keep working unchanged.
COPY requirements.txt server/requirements.txt
# The version checks fail the build, rather than the first request, if the toolchain is broken.
RUN pip install --no-cache-dir -r server/requirements.txt \
    && python -m yt_dlp --version && ffmpeg -version > /dev/null && deno --version > /dev/null
COPY . server/

# Railway injects PORT; Render and docker compose use 8000.
ENV PORT=8000
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import os,sys,urllib.request; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:'+os.environ['PORT']+'/health',timeout=3).status==200 else 1)"

# Shell form so $PORT expands; exec keeps uvicorn as PID 1 for clean shutdowns.
CMD exec python -m uvicorn server.main:app --host 0.0.0.0 --port "$PORT"
