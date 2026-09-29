FROM python:3.12-slim

# ffmpeg on PATH takes precedence over the imageio-ffmpeg fallback in
# downloads.py, so the image starts instantly with no runtime download.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# Copied into app/server (not flattened into /app) so the package's own
# relative imports (`from .database import ...`) keep working unchanged.
COPY requirements.txt server/requirements.txt
RUN pip install --no-cache-dir -r server/requirements.txt
COPY . server/

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health',timeout=3).status==200 else 1)"

CMD ["python", "-m", "uvicorn", "server.main:app", "--host", "0.0.0.0", "--port", "8000"]
