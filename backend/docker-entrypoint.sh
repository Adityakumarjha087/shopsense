#!/bin/sh
set -e
# Apply migrations, seed demo data on first boot, then start the API.
npx prisma migrate deploy
if [ "${SEED_ON_START:-true}" = "true" ]; then
  node dist/seed/index.js --if-empty
fi
exec node dist/server.js
