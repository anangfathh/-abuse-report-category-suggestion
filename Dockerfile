FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 APP_DATABASE_PATH=/app/data/app.sqlite3
COPY --from=build --chown=node:node /app ./
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3040
CMD ["node","node_modules/next/dist/bin/next","start","--hostname","0.0.0.0","--port","3040"]
