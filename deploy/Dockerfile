FROM oven/bun:1.4.2@sha256:9114c058aeae42162ee16dd5084b95fe9473970bb6bcb5b232ab1630f0546895 AS bun
FROM node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df AS dependencies
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
COPY apps/studio/package.json ./apps/studio/package.json
COPY apps/server/package.json ./apps/server/package.json
COPY apps/worker/package.json ./apps/worker/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/reader/package.json ./packages/reader/package.json
COPY packages/export/package.json ./packages/export/package.json
COPY packages/storage/package.json ./packages/storage/package.json
COPY packages/ingestion/package.json ./packages/ingestion/package.json
COPY packages/providers/package.json ./packages/providers/package.json
COPY packages/generation/package.json ./packages/generation/package.json
RUN bun install --frozen-lockfile --ignore-scripts \
    && npm rebuild better-sqlite3
COPY apps ./apps
COPY packages ./packages
COPY tsconfig.base.json ./
RUN bun run --cwd apps/studio build

FROM node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df AS api
ENV NODE_ENV=production HOSTED_ROLE=api
WORKDIR /app
COPY --from=dependencies /app /app
COPY scripts/owner.ts ./scripts/owner.ts
COPY scripts/library.ts ./scripts/library.ts
COPY deploy ./deploy
RUN npm install --global @openai/codex@0.155.1 \
    && apt-get update && apt-get install -y --no-install-recommends age ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /data/private && chown -R node:node /data \
    && chmod 700 /data /data/private && chmod 755 /app/deploy/entrypoint.sh
USER 1000:1000
ENTRYPOINT ["/app/deploy/entrypoint.sh"]
CMD ["node", "--experimental-transform-types", "apps/server/src/index.ts"]

FROM api AS worker
USER root
ENV HOSTED_ROLE=worker PLAYWRIGHT_BROWSERS_PATH=/opt/playwright
RUN node node_modules/@playwright/test/cli.js install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/*
USER 1000:1000
CMD ["node", "--experimental-transform-types", "apps/worker/src/hosted.ts"]

FROM api AS api-wire
COPY tests/deployment ./tests/deployment

FROM worker AS worker-wire
COPY tests/deployment/production-wire.ts ./tests/deployment/production-wire.ts
COPY tests/deployment/production-wire-lesson.ts ./tests/deployment/production-wire-lesson.ts
COPY tests/deployment/production-wire-questions.ts ./tests/deployment/production-wire-questions.ts
COPY tests/deployment/production-wire-server.ts ./tests/deployment/production-wire-server.ts
