#!/bin/sh
set -e

echo "Waiting for database..."
node <<'EOF'
const net = require('net');
const url = process.env.DATABASE_URL || '';
const m = url.match(/@([^:/]+):(\d+)/);
const host = m ? m[1] : 'db';
const port = m ? Number(m[2]) : 5432;
const deadline = Date.now() + 90000;

function tryConnect() {
  return new Promise((resolve, reject) => {
    const s = net.connect({ host, port }, () => {
      s.end();
      resolve();
    });
    s.on('error', reject);
  });
}

(async () => {
  while (Date.now() < deadline) {
    try {
      await tryConnect();
      console.log('Database is reachable at', host + ':' + port);
      process.exit(0);
    } catch {
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  console.error('Database not reachable in time');
  process.exit(1);
})();
EOF

echo "Applying Prisma schema..."
cd /app/apps/api
# قفل advisory اگر از کانتینر قبلی مانده باشد بی‌نهایت منتظر می‌ماند و سلامت API رد می‌شود
export PGOPTIONS="-c lock_timeout=20s -c statement_timeout=120000"
push_ok=0
for attempt in 1 2 3; do
  if CI=true npx prisma db push --skip-generate; then
    push_ok=1
    break
  fi
  echo "Prisma db push failed (attempt ${attempt})"
  sleep 5
done
unset PGOPTIONS
if [ "$push_ok" -ne 1 ]; then
  echo "Prisma db push failed"
  exit 1
fi

echo "Starting API..."
exec node dist/main.js
