#!/usr/bin/env bash
# Accept Planka's terms-of-service for a user, exchanging the pending token for
# a real access token. Planka 2.1.x gates the FIRST login behind this step;
# until it's done, POST /api/access-tokens returns 403 + a pendingToken instead
# of a token, and the MCP server's authenticateAgent cannot log in.
#
# Run this once against a freshly-provisioned instance before the integration
# suite (it's a no-op if terms were already accepted).
#
# Usage: accept-planka-terms.sh <base_url> <email_or_username> <password>
set -euo pipefail

BASE_URL="${1:?base url required}"
EMAIL="${2:?email/username required}"
PASSWORD="${3:?password required}"
JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT

# 1. Login. A terms-gated instance answers 403 with a pendingToken; an already
#    -accepted instance answers 200 with {item: <token>}.
login_body="$(command curl -s -c "$JAR" -X POST "${BASE_URL}/api/access-tokens" \
  -H 'Content-Type: application/json' \
  -d "{\"emailOrUsername\":\"${EMAIL}\",\"password\":\"${PASSWORD}\"}")"

if echo "$login_body" | jq -e '.item' >/dev/null 2>&1; then
  echo "ALREADY_OK: login already returns an access token (terms previously accepted)"
  exit 0
fi

pending="$(echo "$login_body" | jq -r '.pendingToken // empty')"
if [ -z "$pending" ]; then
  echo "NO_PENDING_TOKEN: unexpected login response: ${login_body}"
  exit 1
fi

# 2. Fetch the current terms signature (public endpoint, no auth).
sig="$(command curl -s "${BASE_URL}/api/terms" | jq -r '.item.signature // empty')"
if [ -z "$sig" ]; then
  echo "NO_SIGNATURE: GET /api/terms returned no signature"
  exit 1
fi

# 3. Accept terms -> converts the pendingToken into an access token and stamps
#    user.termsAcceptedAt, so future logins skip the gate. Cookie jar carries
#    the httpOnlyToken the controller binds the session to.
accept_body="$(command curl -s -b "$JAR" -X POST "${BASE_URL}/api/access-tokens/accept-terms" \
  -H 'Content-Type: application/json' \
  -d "{\"pendingToken\":\"${pending}\",\"signature\":\"${sig}\"}")"

if echo "$accept_body" | jq -e '.item' >/dev/null 2>&1; then
  echo "ACCEPTED: terms accepted for ${EMAIL}; access token issued"
  exit 0
fi

echo "ACCEPT_FAILED: ${accept_body}"
exit 1
