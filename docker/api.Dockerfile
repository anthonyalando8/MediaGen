# apps/api — Fastify service.
#
# Build from the REPO ROOT (docker-compose.yml sets context: .) because
# "api" depends on pnpm workspace packages ("core", "schema") that live
# outside apps/api and are resolved through the workspace symlinks pnpm
# creates at install time.
#
# Uses `turbo prune` to copy only the package.json files this app's
# dependency graph actually needs BEFORE running `pnpm install`. The old
# version did `COPY . .` (the whole repo) then `pnpm install` — Docker
# invalidates a layer the moment anything in its COPY changes, and source
# changes on every build, so `pnpm install` reran (and redownloaded
# everything) on every single build regardless of whether a dependency
# actually changed. Pruning first means that layer only reruns when
# package.json/pnpm-lock.yaml for a package THIS app actually depends on
# changes — an edit anywhere else in the repo can't touch it.
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

# Prunes the monorepo down to exactly what "api" depends on, transitively
# (out/json/ = just the package.json files + lockfile, out/full/ = the
# matching pruned SOURCE). turbo itself installed via npm here, not pnpm —
# this stage exists purely to run one CLI command, a full workspace install
# just to get that binary would defeat the point.
FROM base AS pruner
RUN npm install -g turbo@^2.9.0
COPY . .
RUN turbo prune api --docker

FROM base AS deps
# Only the pruned package.json files + lockfile land here — THIS is the
# layer that used to redownload everything; now it only reruns when one of
# these files actually changed.
COPY --from=pruner /app/out/json/ .
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
# Layer the real (pruned) source on top — doesn't touch node_modules from
# the step above, source and deps are separate layers on purpose.
COPY --from=pruner /app/out/full/ .

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
