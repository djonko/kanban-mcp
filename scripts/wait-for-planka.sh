#!/usr/bin/env bash
# Polls Planka's /api/users until it answers 401 (API up, unauthenticated),
# or times out. Usage: wait-for-planka.sh [base_url] [max_attempts]
set -euo pipefail

BASE_URL="${1:-http://localhost:3333}"
MAX_ATTEMPTS="${2:-60}"

for attempt in $(seq 1 "$MAX_ATTEMPTS"); do
  status="$(command curl -s -o /dev/null -w '%{http_code}' "${BASE_URL}/api/users" || echo 000)"
  if [ "$status" = "401" ]; then
    echo "READY after ${attempt}s (HTTP 401 from ${BASE_URL}/api/users)"
    exit 0
  fi
  sleep 1
done

echo "TIMEOUT: ${BASE_URL}/api/users never returned 401 after ${MAX_ATTEMPTS}s (last status: ${status})"
exit 1
