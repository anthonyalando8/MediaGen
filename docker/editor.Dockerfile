# apps/editor — Vite/React frontend.
#
# Build from the REPO ROOT (context: .) — same workspace-package reason as
# docker/api.Dockerfile. Unlike api, a real production build works here:
# Vite/Rollup bundles the workspace TS packages into static output at build
# time, so it doesn't depend on Node resolving "core"/"schema" at runtime.
FROM node:20-slim AS base
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY . .
RUN pnpm install --frozen-lockfile

FROM deps AS dev
WORKDIR /app/apps/editor
ENV NODE_ENV=development
EXPOSE 5173
CMD ["pnpm", "run", "dev"]

FROM deps AS prod
WORKDIR /app/apps/editor
ENV NODE_ENV=production
RUN pnpm run build
EXPOSE 5173
CMD ["pnpm", "run", "preview"]
