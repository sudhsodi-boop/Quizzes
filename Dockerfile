FROM node:22-bookworm AS dependencies
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=4173 DATA_DIR=/app/data
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY package*.json server.js startup-diagnostics.js database-config.js storage.js media-store.js private-image-cache.js studio-server.js professional.js display.html display.js rehearsal.html rehearsal.js qr-code.js backup-service.js seed-quiz.json index.html app.js styles.css quiz-sound.js quiz-import.js quiz-import-worker.js quiz-rules.js workspace-features.js document-format.js extensions.js ./
COPY FONT-LICENSE.txt QR-CODE-LICENSE.txt THIRD-PARTY-NOTICES.md ./
COPY scripts ./scripts
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 4173
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:4173/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
