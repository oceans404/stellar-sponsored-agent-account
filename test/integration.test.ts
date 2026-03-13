import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Keypair, Networks, Account, TransactionBuilder } from '@stellar/stellar-sdk';
import { createApp, type Reservation } from '../src/routes.js';
import { createChannelPool } from '../src/channel-pool.js';
import { createRateLimiter } from '../src/rate-limit.js';
import type { Config } from '../src/config.js';

const sponsorKeypair = Keypair.random();
const channelKeypair1 = Keypair.random();
const channelKeypair2 = Keypair.random();
const usdcIssuer = Keypair.random().publicKey();

const config: Config = {
  network: 'testnet',
  networkPassphrase: Networks.TESTNET,
  sponsorKeypair,
  sponsorPublicKey: sponsorKeypair.publicKey(),
  channelKeypairs: [channelKeypair1, channelKeypair2],
  horizonUrl: 'https://horizon-testnet.stellar.org',
  explorerUrl: 'https://stellar.expert/explorer/testnet',
  usdcIssuer,
  port: 3000,
  rateLimitPerIpWindowMs: 3600000,
  rateLimitPerIpMax: 10,
  channelReservationTtlMs: 60000,
  maxTxFee: 10000,
  maxStartingBalance: 0,
};

// Mock Horizon
vi.mock('@stellar/stellar-sdk', async () => {
  const actual = await vi.importActual<typeof import('@stellar/stellar-sdk')>('@stellar/stellar-sdk');

  const mockLoadAccount = vi.fn();
  const mockSubmitTransaction = vi.fn();

  // Default behavior: channel accounts exist, agent accounts don't
  mockLoadAccount.mockImplementation(async (publicKey: string) => {
    if (
      publicKey === channelKeypair1.publicKey() ||
      publicKey === channelKeypair2.publicKey()
    ) {
      return new actual.Account(publicKey, '100');
    }
    if (publicKey === sponsorKeypair.publicKey()) {
      return {
        ...new actual.Account(publicKey, '50'),
        balances: [{ asset_type: 'native', balance: '1000' }],
      };
    }
    // Agent accounts don't exist
    const err: any = new Error('Not Found');
    err.response = { status: 404 };
    throw err;
  });

  mockSubmitTransaction.mockResolvedValue({
    hash: 'txhash123',
    ledger: 999,
  });

  return {
    ...actual,
    Horizon: {
      Server: vi.fn().mockImplementation(() => ({
        loadAccount: mockLoadAccount,
        submitTransaction: mockSubmitTransaction,
      })),
    },
  };
});

describe('Integration: /create → /submit flow', () => {
  let app: ReturnType<typeof createApp>;
  let channelPool: ReturnType<typeof createChannelPool>;
  let rateLimiter: ReturnType<typeof createRateLimiter>;
  let reservations: Map<string, Reservation>;

  beforeEach(() => {
    channelPool = createChannelPool([channelKeypair1, channelKeypair2]);
    rateLimiter = createRateLimiter(config.rateLimitPerIpWindowMs, config.rateLimitPerIpMax);
    reservations = new Map();
    app = createApp({ config, channelPool, rateLimiter, reservations });
  });

  it('full create → submit flow succeeds', async () => {
    const agentKeypair = Keypair.random();

    // POST /create
    const createRes = await app.request('/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '1.2.3.4',
      },
      body: JSON.stringify({ public_key: agentKeypair.publicKey() }),
    });

    expect(createRes.status).toBe(200);
    const createBody = await createRes.json();
    expect(createBody.xdr).toBeDefined();
    expect(createBody.network_passphrase).toBe(Networks.TESTNET);

    // Agent signs the XDR
    const tx = TransactionBuilder.fromXDR(
      createBody.xdr,
      Networks.TESTNET,
    ) as any;
    tx.sign(agentKeypair);
    const signedXdr = tx.toXDR();

    // POST /submit
    const submitRes = await app.request('/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ xdr: signedXdr }),
    });

    expect(submitRes.status).toBe(201);
    const submitBody = await submitRes.json();
    expect(submitBody.status).toBe('ok');
    expect(submitBody.hash).toBe('txhash123');
    expect(submitBody.agent_public_key).toBe(agentKeypair.publicKey());
  });

  it('rejects invalid public key', async () => {
    const res = await app.request('/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '1.2.3.4',
      },
      body: JSON.stringify({ public_key: 'not-a-key' }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('VALIDATION_FAILED');
  });

  it('rejects duplicate sponsorship', async () => {
    const agentKeypair = Keypair.random();

    // First create succeeds
    const res1 = await app.request('/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '1.2.3.4',
      },
      body: JSON.stringify({ public_key: agentKeypair.publicKey() }),
    });
    expect(res1.status).toBe(200);

    // Complete the flow to record sponsorship
    const body1 = await res1.json();
    const tx = TransactionBuilder.fromXDR(body1.xdr, Networks.TESTNET) as any;
    tx.sign(agentKeypair);

    await app.request('/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ xdr: tx.toXDR() }),
    });

    // Second create for same key should be rejected
    const res2 = await app.request('/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '5.6.7.8',
      },
      body: JSON.stringify({ public_key: agentKeypair.publicKey() }),
    });

    expect(res2.status).toBe(429);
  });

  it('GET /info returns service info', async () => {
    const res = await app.request('/info');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sponsor_public_key).toBe(sponsorKeypair.publicKey());
    expect(body.network_passphrase).toBe(Networks.TESTNET);
    expect(body.usdc_issuer).toBe(usdcIssuer);
    expect(body.available_channels).toBe(2);
  });

  it('GET /health returns health status', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.network).toBe('testnet');
    expect(body.channels.total).toBe(2);
  });

  it('handles concurrent create requests', async () => {
    const agent1 = Keypair.random();
    const agent2 = Keypair.random();

    const [res1, res2] = await Promise.all([
      app.request('/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': '1.2.3.4',
        },
        body: JSON.stringify({ public_key: agent1.publicKey() }),
      }),
      app.request('/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': '5.6.7.8',
        },
        body: JSON.stringify({ public_key: agent2.publicKey() }),
      }),
    ]);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    // Both should use different channels
    expect(reservations.size).toBe(2);
    expect(channelPool.availableCount()).toBe(0);
  });
});
