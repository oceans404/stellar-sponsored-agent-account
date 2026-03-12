# Stellar Sponsored Agent Account

Give any AI agent a Stellar USDC wallet in two API calls. No prior balance needed. Costs 1 XLM per account (~$0.16 as of March 2026), covered by the service operator.

AI agents need a Stellar account to send and receive USDC. Creating one normally requires XLM (Stellar's native currency) — a chicken-and-egg problem. This service solves it by covering the ~1 XLM setup cost on behalf of the agent using Stellar's built-in [sponsorship protocol](https://developers.stellar.org/docs/glossary/sponsored-reserves/). The agent keeps full control of its own keys.

### How it works

1. Agent generates a keypair locally (private key never leaves the agent)
2. Agent calls `POST /create` with its public key — service builds a sponsored account creation transaction
3. Agent inspects the transaction, signs it, and calls `POST /submit`
4. Service co-signs and submits to the Stellar network — agent has a live USDC-ready account

This is the reference implementation for Stellar agent account sponsorship. It's open source — anyone can fork, deploy, and fund with their own XLM. The Stellar Foundation runs a public instance as a fallback for agents that aren't going through a wallet service.

The service includes a **skill** (`GET /skill.md`) — a self-contained guide written for AI agents that teaches them how to use the API end-to-end. Point an agent at this endpoint and it has everything it needs: prerequisites, step-by-step flow, code examples, error handling, and trust model. See [`src/skill.md`](src/skill.md) for the source.

## Quick Start

```bash
# Install dependencies
npm install

# Copy and configure environment
cp .env.example .env
```

### Testnet setup

```bash
# Generate a sponsor keypair (the account that pays for agent onboarding)
node -e "const { Keypair } = require('@stellar/stellar-sdk'); const kp = Keypair.random(); console.log('Public:', kp.publicKey()); console.log('Secret:', kp.secret())"

# Fund it via friendbot (10,000 testnet XLM)
curl "https://friendbot.stellar.org?addr=<SPONSOR_PUBLIC_KEY>"

# Create channel accounts (used for concurrent onboarding)
npx tsx scripts/setup-channels.ts --sponsor-secret <SPONSOR_SECRET_KEY> --count 5
```

Add the `SPONSOR_SECRET_KEY` and `CHANNEL_SECRET_KEYS` (from the script output) to your `.env`.

### Run

```bash
# Development
npm run dev

# Production
npm run build
npm start

# Tests
npm test
```

## API

Full API spec is auto-generated and available at `GET /openapi.json`.

### `POST /create`

Request an unsigned sponsorship transaction for an agent's public key.

```bash
curl -s -X POST http://localhost:3000/create \
  -H "Content-Type: application/json" \
  -d '{"public_key": "GABC..."}' | jq .
```

Returns unsigned XDR (Stellar's transaction format) for the agent to inspect and sign.

### `POST /submit`

Submit the agent-signed transaction for sponsor co-signing and network submission.

```bash
curl -s -X POST http://localhost:3000/submit \
  -H "Content-Type: application/json" \
  -d '{"xdr": "<AGENT_SIGNED_XDR>"}' | jq .
```

### `GET /info`

Service configuration: sponsor key, balance, network, USDC issuer, explorer URL, available channels, and links to API docs and agent skill.

### `GET /health`

Health check with sponsor balance and channel pool status.

### `GET /skill.md`

Agent-facing onboarding guide. If an AI agent discovers this service, this endpoint tells it exactly how to get a Stellar USDC wallet — step by step, with code examples. Served with dynamic values (base URL, network, reservation TTL).

### `GET /openapi.json`

Auto-generated OpenAPI 3.1 spec. Stays in sync with the route definitions and Zod schemas automatically.

## Integration Example

The full flow in TypeScript:

```typescript
import { Keypair, TransactionBuilder } from '@stellar/stellar-sdk';

const SERVICE = 'http://localhost:3000';

// 1. Generate keypair
const agent = Keypair.random();

// 2. Request sponsored account
const { xdr, network_passphrase } = await fetch(`${SERVICE}/create`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ public_key: agent.publicKey() }),
}).then(r => r.json());

// 3. Inspect, sign, submit
const tx = TransactionBuilder.fromXDR(xdr, network_passphrase);
tx.sign(agent);

const result = await fetch(`${SERVICE}/submit`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ xdr: tx.toXDR() }),
}).then(r => r.json());

// Done — result.agent_public_key has a USDC-ready Stellar account
// result.explorer_url links to the transaction on the Stellar explorer
```

Use the OpenAPI spec at `/openapi.json` to generate a typed client in your language of choice.

## End-to-End Test

The easiest way to test the full flow:

```bash
stellar keys generate test-agent
./scripts/test-flow.sh test-agent
```

This runs create → sign → submit → verify in one shot.

## Configuration

See `.env.example` for all options.

| Variable | Description | Default |
|----------|-------------|---------|
| `NETWORK` | `testnet` or `public` | required |
| `SPONSOR_SECRET_KEY` | Sponsor account secret key | required |
| `CHANNEL_SECRET_KEYS` | Comma-separated channel account keys | required |
| `HORIZON_URL` | Horizon (Stellar API) server URL | required |
| `USDC_ISSUER` | USDC asset issuer public key | required |
| `EXPLORER_URL` | Stellar block explorer URL | required |
| `PORT` | Server port | `3000` |
| `MAX_TX_FEE` | Max transaction fee in stroops (1 stroop = 0.0000001 XLM) | `10000` |
| `MAX_STARTING_BALANCE` | Max starting balance in stroops | `1` |
| `RATE_LIMIT_PER_IP_WINDOW_MS` | IP rate limit window | `3600000` (1 hour) |
| `RATE_LIMIT_PER_IP_MAX` | Max requests per IP per window | `5` |
| `CHANNEL_RESERVATION_TTL_MS` | TTL for unredeemed `/create` responses | `30000` (30s) |

## For Platform Integrators

If you're a wallet service (Privy, Dynamic, CDP, etc.) evaluating Stellar as a payment rail for your agents:

- **What you run:** This service, deployed with your own sponsor account and XLM
- **What it costs:** ~1 XLM per agent (~$0.16 as of March 2026) in locked reserves (not spent — recoverable if the account is later merged)
- **What your agents get:** A fully active Stellar account with a USDC trustline, ready to receive payments immediately
- **Integration effort:** Two HTTP calls. See the [Integration Example](#integration-example) above or the OpenAPI spec at `/openapi.json`

The sponsorship cost is comparable to covering gas on EVM chains, but uses Stellar's native protocol-level sponsorship — no paymaster contracts or relayer infrastructure needed.

## Working Example (Testnet)

Here's a real agent account created by this service on testnet:

**Agent account:** [`GBNJEFM4EE4CNPGFFKWUD2A4Z5AHSIHQK7CMPURWGMSZWCVEZLEIIB5H`](https://stellar.expert/explorer/testnet/account/GBNJEFM4EE4CNPGFFKWUD2A4Z5AHSIHQK7CMPURWGMSZWCVEZLEIIB5H)

The single atomic sponsorship transaction performed all four operations:

1. `GBHW...OV4H` sponsored reserves for `GBNJ...IB5H`
2. `GBHW...OV4H` created account `GBNJ...IB5H` with starting balance 0.0000001 XLM
3. `GBNJ...IB5H` established trustline to USDC (`GBBD...FLA5`)
4. Finished sponsoring reserves for `GBNJ...IB5H`

After onboarding, the account was funded with USDC via the [Circle faucet](https://faucet.circle.com/) — no additional setup needed.

## Architecture

The service uses **channel accounts** for concurrency — each concurrent sponsorship gets its own sequence number, so multiple agents can onboard simultaneously without bottlenecks. Each onboarding transaction is co-signed by the service and the agent, ensuring neither party can act alone.


## Deploy Your Own Instance

```bash
docker build -t stellar-agent-account .
docker run -p 3000:3000 --env-file .env stellar-agent-account
```

You'll need a funded sponsor account and channel accounts. See [Testnet setup](#testnet-setup) for how to create them.
