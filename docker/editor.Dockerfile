# apps/editor — Vite/React frontend.
#
# Build from the REPO ROOT (context: .) — same workspace-package reason as
# docker/api.Dockerfile. Unlike api, a real production build works here:
# Vite/Rollup bundles the workspace TS packages into static output at build
# time, so it doesn't depend on Node resolving "core"/"schema" at runtime.
#
# Uses `turbo prune` (see docker/api.Dockerfile for the full explanation) so
# `pnpm install` only reruns when a dependency this app actually uses
# changed, instead of on every source-code change anywhere in the repo.
FROM node:20-slim AS base
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

FROM base AS pruner
RUN npm install -g turbo@^2.9.0
COPY . .
RUN turbo prune editor --docker

FROM base AS deps
COPY --from=pruner /app/out/json/ .
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .

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
