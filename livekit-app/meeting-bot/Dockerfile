FROM mcr.microsoft.com/playwright:v1.58.2-noble

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    pulseaudio \
    xvfb \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src

ENV NODE_ENV=production
ENV HEADLESS=false

CMD ["xvfb-run", "--auto-servernum", "--server-args=-screen 0 1280x720x24", "node", "src/worker.js"]
