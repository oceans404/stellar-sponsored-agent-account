---
name: stellar-sponsored-agent-account
description: Create a Stellar USDC wallet for an AI agent in two API calls. Use when an agent needs to hold, receive, or send USDC on Stellar {{NETWORK}} and doesn't have a Stellar account yet.
license: MIT
metadata:
  author: oceans404
  version: "1.0"
  source: https://github.com/oceans404/stellar-sponsored-agent-account
---

# Stellar Sponsored Agent Account

> Base URL: `{{BASE_URL}}`
> Network: **{{NETWORK}}**
> Source: [github.com/oceans404/stellar-sponsored-agent-account](https://github.com/oceans404/stellar-sponsored-agent-account)

You are an AI agent that needs a Stellar account to send and receive USDC on the Stellar blockchain {{NETWORK}}. This skill tells you how to get one in two API calls, with no XLM or prior Stellar setup required.

---

## What You Get

- A funded Stellar account (reserves sponsored — you pay nothing)
- A USDC trustline (ready to receive USDC on Stellar {{NETWORK}} immediately)
- Full self-custody (you generate and hold your own keys)

Total cost to you: **zero**. The service sponsors ~1.0 XLM in reserves on your behalf.

| Item | XLM | Who pays |
|------|-----|----------|
| Base account reserve | 0.5 XLM | Sponsor (locked) |
| USDC trustline reserve | 0.5 XLM | Sponsor (locked) |
| Starting balance | 0.0000001 XLM | Sponsor (transferred) |
| Transaction fee | ~0.0001 XLM | Sponsor |
| **Total** | **~1.0 XLM** | **Sponsor** |

The reserves are locked, not transferred. They stay on the sponsor's account but are earmarked for your account's existence. You don't need to pay anything back.

---

## Prerequisites

Install the [Stellar CLI](https://github.com/stellar/stellar-cli) (recommended for key generation and transaction signing):

```bash
# macOS/Linux (Homebrew)
brew install stellar-cli

# macOS/Linux (script)
curl -fsSL https://github.com/stellar/stellar-cli/raw/main/install.sh | sh

# Windows
winget install --id Stellar.StellarCLI
```

Alternatively, you can use the `@stellar/stellar-sdk` npm package or any Stellar SDK if you prefer to work in code.

---

## API Shape

The full flow is two HTTP calls. Here are the exact JSON request and response bodies:

```
POST /create
  Request:  { "public_key": "<your Stellar public key>" }
  Response: { "xdr": "<unsigned transaction XDR>", "network_passphrase": "..." }

POST /submit
  Request:  { "xdr": "<agent-signed XDR>" }
  Response: { "status": "ok", "hash": "...", "ledger": ..., "agent_public_key": "...", "explorer_url": "..." }
```

The field name is `xdr` in both the `/create` response and the `/submit` request. Not `unsigned_xdr`, not `signed_xdr` — just `xdr`.

**Important:** You must call `/submit` within {{RESERVATION_TTL_SECONDS}} seconds of `/create`. If the reservation expires, just call `/create` again to get a fresh transaction, then inspect, sign, and `/submit` as normal.

---

## Flow

### Step 1: Check the service

Before starting, verify the service is available and note its configuration.

```bash
curl -s {{BASE_URL}}/info | jq .
```

```json
{
  "sponsor_public_key": "GBHW...",
  "sponsor_balance_xlm": "9998.9999800",
  "network_passphrase": "Test SDF Network ; September 2015",
  "usdc_issuer": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  "horizon_url": "https://horizon-testnet.stellar.org",
  "available_channels": 5,
  "api_docs": "/openapi.json",
  "agent_skill": "/SKILL.md"
}
```

If `available_channels` is 0, wait a moment and retry — the service is at capacity.

### Step 2: Generate a keypair

Generate a Stellar Ed25519 keypair. **Store the secret key securely — it is your only way to control this account.**

Using the Stellar CLI:

```bash
stellar keys generate my-agent
stellar keys address my-agent
# → GABC...
```

Using the JS SDK:

```js
import { Keypair } from '@stellar/stellar-sdk';
const kp = Keypair.random();
// kp.publicKey()  → "GABC..."
// kp.secret()     → "SABC..." (store securely)
```

### Step 3: Request a sponsored account

```bash
curl -s -X POST {{BASE_URL}}/create \
  -H "Content-Type: application/json" \
  -d '{"public_key": "GABC..."}' | jq .
```

Response (200):

```json
{
  "xdr": "<unsigned transaction XDR>",
  "network_passphrase": "Test SDF Network ; September 2015"
}
```

The service builds a transaction that will:
- Create your account (1 stroop starting balance)
- Add a USDC trustline
- Sponsor both reserves (~1.0 XLM, locked on your behalf)

### Step 4: Inspect the transaction (recommended)

Before signing, verify the XDR contains only what you expect.

Using the Stellar CLI:

```bash
stellar tx decode "<XDR>"
```

Check that:
- Exactly 4 operations: `beginSponsoringFutureReserves`, `createAccount`, `changeTrust`, `endSponsoringFutureReserves`
- `createAccount` destination is your public key
- `changeTrust` is for USDC with the issuer from `/info`
- Starting balance is 0.0000001 XLM (1 stroop)
- No unexpected operations or memo

**Do not sign if anything looks wrong.**

### Step 5: Sign the transaction

Using the Stellar CLI:

```bash
stellar tx sign "<XDR>" --sign-with-key my-agent
# → <signed XDR>
```

Using the JS SDK:

```js
import { TransactionBuilder } from '@stellar/stellar-sdk';
const tx = TransactionBuilder.fromXDR(xdr, networkPassphrase);
tx.sign(keypair);
const signedXdr = tx.toXDR();
```

Your signature authorizes the trustline and confirms you consent to the account setup. The service cannot submit without it.

### Step 6: Submit the signed transaction

```bash
curl -s -X POST {{BASE_URL}}/submit \
  -H "Content-Type: application/json" \
  -d '{"xdr": "<signed XDR>"}' | jq .
```

Response (201):

```json
{
  "status": "ok",
  "hash": "3a10ce7e...",
  "ledger": 1453358,
  "agent_public_key": "GABC...",
  "explorer_url": "{{EXPLORER_URL}}/tx/3a10ce7e..."
}
```

**Done.** Your Stellar account is live and can receive USDC. The `explorer_url` links directly to the atomic sponsorship transaction on the [Stellar explorer]({{EXPLORER_URL}}).

---

## Scripted Flow (Bash)

The full flow in one copy-paste script:

```bash
#!/bin/bash
set -e

SERVICE_URL="{{BASE_URL}}"
AGENT_NAME="my-agent"

# Generate keypair (skip if already created)
stellar keys generate "$AGENT_NAME" 2>/dev/null || true
AGENT_PK=$(stellar keys address "$AGENT_NAME")

# Request sponsored account
XDR=$(curl -s -X POST "$SERVICE_URL/create" \
  -H "Content-Type: application/json" \
  -d "{\"public_key\": \"$AGENT_PK\"}" | jq -r '.xdr')

# Sign
SIGNED_XDR=$(stellar tx sign "$XDR" --sign-with-key "$AGENT_NAME")

# Submit
curl -s -X POST "$SERVICE_URL/submit" \
  -H "Content-Type: application/json" \
  -d "{\"xdr\": \"$SIGNED_XDR\"}" | jq .
```

---

## Complete Example (JS SDK)

```js
import { Keypair, TransactionBuilder } from '@stellar/stellar-sdk';

const SERVICE = '{{BASE_URL}}';

// 1. Generate keypair
const kp = Keypair.random();

// 2. Request sponsored account
const createRes = await fetch(`${SERVICE}/create`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ public_key: kp.publicKey() }),
});
const { xdr, network_passphrase } = await createRes.json();

// 3. Sign
const tx = TransactionBuilder.fromXDR(xdr, network_passphrase);
tx.sign(kp);

// 4. Submit
const submitRes = await fetch(`${SERVICE}/submit`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ xdr: tx.toXDR() }),
});
const result = await submitRes.json();
// { status: "ok", hash: "...", ledger: ..., agent_public_key: "G..." }
```

---

## Trust Model

You never send your private key to the service. The flow is designed so you can verify everything before signing:

1. The service builds the transaction and sends you unsigned XDR
2. You inspect it to confirm it only contains the expected 4 operations
3. You sign it — your signature only authorizes what you inspected
4. The service adds its own signatures and submits

If the XDR contains anything unexpected, don't sign it.

---

## Error Handling

All errors follow this format:

```json
{
  "status": "error",
  "code": "RATE_LIMITED",
  "message": "Rate limit exceeded. Try again later.",
  "retryable": true
}
```

Check the `retryable` field to decide whether to retry.

| Code | Status | What to do |
|------|--------|------------|
| `VALIDATION_FAILED` | 400 | Fix the request — bad public key, tampered XDR, or invalid signature |
| `NOT_FOUND` | 404 | Your reservation expired. Call `POST /create` again |
| `RATE_LIMITED` | 429 | Wait and retry, or use a different public key if already sponsored |
| `HORIZON_ERROR` | 502 | Stellar network issue. Retry after a moment |
| `SERVICE_UNAVAILABLE` | 503 | All channels busy. Retry after a moment |

---

## Important Notes

- **One account per public key.** The service will reject a second sponsorship for the same key.
- **Reservations expire in {{RESERVATION_TTL_SECONDS}} seconds.** If you don't call `/submit` within {{RESERVATION_TTL_SECONDS}}s of `/create`, the reservation is discarded. Just call `/create` again.
- **Your private key never leaves your environment.** The service only sees your public key and your signature. It cannot spend your funds.
- **You can receive USDC immediately** after the account is created. No further setup needed.
- **The full OpenAPI spec** is available at `GET /openapi.json` if you need programmatic API discovery.
