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
# nginx IP کانتینر api/web را در شروع resolve می‌کند؛ بعد از recreate باید از نو بالا بیاید
$DC up -d --force-recreate --no-deps nginx
$DC ps

NGINX_PORT="${NGINX_HTTP_PORT:-80}"

echo "==> Wait for nginx /api/health on :$NGINX_PORT"
for i in $(seq 1 40); do
  if curl -fsS -H "Host: sabad-yar.ir" "http://127.0.0.1:$NGINX_PORT/api/health" >/dev/null 2>&1; then
    echo "API is healthy via nginx"
    break
  fi
  if [ "$i" -eq 40 ]; then
    echo "API health check timed out"
    $DC logs --tail=80 nginx api || true
    exit 1
  fi
  sleep 5
done

echo "==> Wait for site via nginx on :$NGINX_PORT"
for i in $(seq 1 20); do
  if curl -fsS -H "Host: sabad-yar.ir" "http://127.0.0.1:$NGINX_PORT/nginx-health" >/dev/null 2>&1; then
    echo "Nginx is healthy"
    break
  fi
  if [ "$i" -eq 20 ]; then
    echo "Nginx health check timed out"
    $DC logs --tail=80 nginx web || true
    exit 1
  fi
  sleep 3
done

docker image prune -f || sudo docker image prune -f || true
echo "==> Deploy finished"
