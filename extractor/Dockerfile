FROM python:3.11-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
      libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
# Cloud Run injects PORT (defaults to 8080); fall back to 8081 for local dev.
ENV PORT=8081
EXPOSE 8081
CMD ["sh", "-c", "exec uvicorn app:app --host 0.0.0.0 --port ${PORT}"]
