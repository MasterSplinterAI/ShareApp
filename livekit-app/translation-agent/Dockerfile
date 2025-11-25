# Translation Agent Dockerfile for LiveKit Cloud
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies for audio processing
RUN apt-get update && apt-get install -y \
    ffmpeg \
    libportaudio2 \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better caching
COPY requirements_livekit.txt requirements.txt

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Set environment variables
ENV PYTHONUNBUFFERED=1

# Run the agent (LiveKit Cloud will handle the entrypoint)
# Use python -u for unbuffered output and pass 'start' command for cli.run_app()
CMD ["python", "-u", "realtime_agent_simple.py", "start"]
