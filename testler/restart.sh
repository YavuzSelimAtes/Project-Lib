#!/bin/sh
# Test backend'ini (4100) kapatip temiz DB ile baslatir, seed'i calistirir.
cd "$(dirname "$0")/.."
pid=$(netstat -ano | grep ':4100 .*LISTENING' | awk '{print $5}' | head -1)
[ -n "$pid" ] && taskkill //PID "$pid" //F >/dev/null 2>&1
sleep 1
(node testler/start-backend.js --fresh > testler/data/server.log 2>&1 &)
node testler/seed-demo.js
