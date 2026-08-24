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
npx prisma db push --skip-generate

echo "Starting API..."
exec node dist/main.js
