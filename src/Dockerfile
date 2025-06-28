# ───────── FRONT-END BUILD ─────────
FROM node:20-alpine AS frontend-build
WORKDIR /app
COPY frontend/package.json frontend/vite.config.js /app/
COPY frontend/index.html /app/
COPY frontend/src /app/src
RUN npm install && npm run build

# ───────── BACK-END ─────────
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache git openssh curl

COPY backend/package.json /app/
RUN npm install --omit=dev

COPY backend/src /app/src
COPY --from=frontend-build /app/dist /app/public
EXPOSE 8080
CMD ["node", "src/index.js"]
