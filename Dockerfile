FROM node:20-alpine AS base

RUN apk add --no-cache dumb-init

WORKDIR /app

COPY package*.json ./

FROM base AS dependencies

RUN npm ci --only=production && \
    npm cache clean --force

FROM base AS build

RUN npm ci && \
    npm cache clean --force

COPY . .

FROM base AS production

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=build /app/src ./src
COPY --from=build /app/src/db/migrations ./src/db/migrations
COPY --from=build /app/docs/swagger.yaml ./docs/swagger.yaml
COPY --from=build /app/package*.json ./

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

USER nodejs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

ENTRYPOINT ["dumb-init", "--"]

CMD ["sh", "-c", "node src/db/migrate.js migrate && node src/index.js"]