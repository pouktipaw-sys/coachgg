# CoachGG — image unique (site web + worker vidéo), compatible ARM (Oracle Ampere) et x86.
# Contient Node, FFmpeg, Python + OpenCV (analyse), polices pour les clips annotés.
FROM node:22-trixie-slim AS node

FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg python3 python3-venv fonts-dejavu-core ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*

# Node 22 (binaire officiel, multi-architecture)
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
  && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
  && node --version && npm --version

WORKDIR /app

# Python de l'analyse (couche en cache tant que requirements.txt ne change pas)
COPY analysis/requirements.txt analysis/requirements.txt
RUN python3 -m venv .venv-analysis \
  && .venv-analysis/bin/pip install --no-cache-dir --upgrade pip \
  && .venv-analysis/bin/pip install --no-cache-dir -r analysis/requirements.txt

# Dépendances Node (en cache tant que package-lock.json ne change pas)
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund

COPY . .
# Aucune connexion pendant la construction : URL factice, la vraie est fournie au démarrage.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npx next build

ENV NODE_ENV=production \
    STORAGE_DIR=/app/storage \
    NEXT_TELEMETRY_DISABLED=1
EXPOSE 3000
CMD ["npm", "run", "start"]
