#!/bin/bash
set -e

AGENT_NAME="${1:-test-agent}"
SERVICE_URL="${2:-http://localhost:3000}"

# Get agent public key
AGENT_PK=$(stellar keys address "$AGENT_NAME")
echo "Agent public key: $AGENT_PK"

# Step 1: Create
echo ""
echo "=== POST /create ==="
CREATE_RESPONSE=$(curl -s -X POST "$SERVICE_URL/create" \
  -H "Content-Type: application/json" \
  -d "{\"public_key\": \"$AGENT_PK\"}")
echo "$CREATE_RESPONSE" | jq .

XDR=$(echo "$CREATE_RESPONSE" | jq -r '.xdr')
if [ "$XDR" = "null" ] || [ -z "$XDR" ]; then
  echo "ERROR: No XDR in response"
  exit 1
fi

# Step 2: Sign
echo ""
echo "=== Signing ==="
SIGNED_XDR=$(stellar tx sign "$XDR" --sign-with-key "$AGENT_NAME")
echo "Signed OK"

# Step 3: Submit
echo ""
echo "=== POST /submit ==="
curl -s -X POST "$SERVICE_URL/submit" \
  -H "Content-Type: application/json" \
  -d "{\"xdr\": \"$SIGNED_XDR\"}" | jq .

# Step 4: Verify
echo ""
echo "=== Verify on Horizon ==="
HORIZON_URL=$(curl -s "$SERVICE_URL/info" | jq -r '.horizon_url')
curl -s "$HORIZON_URL/accounts/$AGENT_PK" | jq '.balances'
