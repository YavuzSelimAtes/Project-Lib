# --- arayuz derlemesi ---
FROM node:24-alpine AS web
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# --- calisma imaji ---
FROM node:24-alpine
WORKDIR /app/backend
ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/data/kutuphane.db \
    COVERS_DIR=/data/covers \
    TRUST_PROXY=1 \
    COOKIE_SECURE=1 \
    TZ_NAME=Europe/Istanbul
COPY backend/package*.json ./
RUN npm ci --omit=dev
COPY backend/ ./
COPY --from=web /app/frontend/dist /app/frontend/dist
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:3000/api/auth/me >/dev/null 2>&1 || wget -qO- http://127.0.0.1:3000/ >/dev/null 2>&1 || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.js"]
