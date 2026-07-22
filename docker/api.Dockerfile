# apps/api — Fastify service.
#
# Build from the REPO ROOT (docker-compose.yml sets context: .) because
# "api" depends on pnpm workspace packages ("core", "schema") that live
# outside apps/api and are resolved through the workspace symlinks pnpm
# creates at install time.
#
# NOTE on the "prod" target: packages/* all declare "main": "src/index.ts"
# (consumed as TS source by tsx/vite, never built to dist for runtime — see
# packages/core/package.json). So a real `tsc` build + plain `node dist/`
# would fail to resolve workspace imports. "prod" here means
# NODE_ENV=production with tsx running once (no --watch), not a compiled
# artifact — that's the honest state of this monorepo today, not a Docker
# limitation.
FROM node:20-slim AS base
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY . .
RUN pnpm install --frozen-lockfile

FROM deps AS dev
WORKDIR /app/apps/api
ENV NODE_ENV=development
EXPOSE 3001
CMD ["pnpm", "run", "dev"]

FROM deps AS prod
WORKDIR /app/apps/api
ENV NODE_ENV=production
EXPOSE 3001
CMD ["pnpm", "exec", "tsx", "src/index.ts"]
