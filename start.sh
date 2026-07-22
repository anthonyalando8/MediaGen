#!/usr/bin/env bash
# Starts editor, api, and python together via docker-compose.
#
# Ordering isn't done by this script — docker-compose.yml's healthchecks +
# depends_on already make editor wait for api and python to report healthy
# before it starts (api and python have no dependency on each other, so they
# start in parallel). This script is just the one entry point.
#
# Dev mode (hot reload, default): ./start.sh
# Prod mode (built/bundled, no bind-mounted source): ./start.sh --prod
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

if [[ "${1:-}" == "--prod" ]]; then
  echo "[start] prod mode (docker-compose.yml only)"
  docker compose -f docker-compose.yml up --build
else
  echo "[start] dev mode (docker-compose.yml + docker-compose.override.yml)"
  docker compose up --build
fi
