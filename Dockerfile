FROM node:22-bookworm AS dependencies
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=4173 DATA_DIR=/app/data
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY package*.json server.js storage.js media-store.js backup-service.js seed-quiz.json index.html app.js styles.css ./
COPY scripts ./scripts
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 4173
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:4173/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
