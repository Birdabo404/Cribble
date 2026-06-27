#!/bin/bash
# Smoke-test all Next.js API routes. Expect 401/400 on protected or invalid bodies.
set -euo pipefail

BASE="${1:-http://localhost:3000}"

check() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  local code

  if [ -n "$body" ]; then
    code=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" "$BASE$path" \
      -H "Content-Type: application/json" \
      -d "$body")
  else
    code=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" "$BASE$path")
  fi

  echo "$method $path -> $code"
}

echo "API Smoke Test against $BASE"
echo "================================"

check GET  /api/leaderboard
check GET  /api/waitlist
check POST /api/waitlist '{"email":"smoke@test.example.com"}'
check GET  /api/auth/github
check GET  /api/auth/twitter
check POST /api/auth/logout
check GET  /api/user/me
check GET  /api/user/activity
check GET  /api/user/tools
check GET  /api/user/onboarding
check POST /api/user/onboarding '{}'
check GET  /api/user/score
check POST /api/user/score '{}'
check DELETE /api/user/delete
check GET  /api/extension/sync
check POST /api/extension/sync '{}'
check DELETE /api/extension/sync
check GET  /api/extension/devices
check POST /api/extension/devices '{}'
check DELETE /api/extension/devices
check POST /api/device/status '{}'
check GET  /api/device/verify
check POST /api/device/verify '{}'
check GET  /api/debug/scores
check GET  /api/debug/table-info
check POST /api/debug/cleanup '{}'
check POST /api/debug/reset '{}'

echo "================================"
echo "Done. Review codes above — 404/500 are bugs; 401/400 are expected for unauthenticated smoke."
