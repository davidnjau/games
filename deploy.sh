#!/bin/bash
# Run on the games server (via the restricted CI deploy key — see
# .github/workflows/deploy.yml). Pulls the latest main and rebuilds.
set -e
cd "$(dirname "$0")"
git fetch origin main
git reset --hard origin/main
docker compose up --build -d
docker image prune -f
