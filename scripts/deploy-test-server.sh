#!/usr/bin/env bash
# استقرار دستی روی سرور تست — همان مراحلی که GitHub Actions اجرا می‌کند.
# از ریشهٔ clone روی سرور:
#   bash scripts/deploy-test-server.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

echo "==> Pull latest main"
git fetch origin main
git reset --hard origin/main

if docker info >/dev/null 2>&1; then
  DC="docker compose"
else
  DC="sudo docker compose"
fi

echo "==> Build and start stack ($DC)"
$DC pull || true
$DC up -d --build
$DC ps

API_PORT="${API_HOST_PORT:-3001}"
WEB_PORT="${WEB_HOST_PORT:-3000}"

echo "==> Wait for API on :$API_PORT"
for i in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:$API_PORT/api/market/quotes?take=1" >/dev/null 2>&1; then
    echo "API is healthy"
    break
  fi
  if [ "$i" -eq 40 ]; then
    echo "API health check timed out"
    $DC logs --tail=80 api || true
    exit 1
  fi
  sleep 5
done

echo "==> Wait for Web on :$WEB_PORT"
for i in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:$WEB_PORT" >/dev/null 2>&1; then
    echo "Web is healthy"
    break
  fi
  if [ "$i" -eq 20 ]; then
    echo "Web health check timed out"
    $DC logs --tail=80 web || true
    exit 1
  fi
  sleep 3
done

docker image prune -f || sudo docker image prune -f || true
echo "==> Deploy finished"
