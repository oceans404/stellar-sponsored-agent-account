import { describe, it, expect, vi } from 'vitest';
import { Keypair, Networks, Account } from '@stellar/stellar-sdk';
import { buildSponsorshipTransaction } from '../src/sponsor.js';
import type { Config } from '../src/config.js';
import type { Channel } from '../src/channel-pool.js';

const sponsorKeypair = Keypair.random();
const channelKeypair = Keypair.random();
const agentKeypair = Keypair.random();
const usdcIssuer = Keypair.random().publicKey();

const config: Config = {
  network: 'testnet',
  networkPassphrase: Networks.TESTNET,
  sponsorKeypair,
  sponsorPublicKey: sponsorKeypair.publicKey(),
  channelKeypairs: [channelKeypair],
  horizonUrl: 'https://horizon-testnet.stellar.org',
  explorerUrl: 'https://stellar.expert/explorer/testnet',
  usdcIssuer,
  port: 3000,
  rateLimitPerIpWindowMs: 3600000,
  rateLimitPerIpMax: 5,
  channelReservationTtlMs: 60000,
  maxTxFee: 10000,
  maxStartingBalance: 1,
};

const channel: Channel = {
  keypair: channelKeypair,
  publicKey: channelKeypair.publicKey(),
};

// Mock Horizon server
vi.mock('@stellar/stellar-sdk', async () => {
  const actual = await vi.importActual<typeof import('@stellar/stellar-sdk')>('@stellar/stellar-sdk');
  return {
    ...actual,
    Horizon: {
      Server: vi.fn().mockImplementation(() => ({
        loadAccount: vi.fn().mockResolvedValue(
          new actual.Account(channelKeypair.publicKey(), '100'),
        ),
        submitTransaction: vi.fn().mockResolvedValue({
          hash: 'abc123',
          ledger: 12345678,
        }),
      })),
    },
  };
});

describe('buildSponsorshipTransaction', () => {
  it('builds a transaction with 4 correct operations', async () => {
    const result = await buildSponsorshipTransaction(
      agentKeypair.publicKey(),
      channel,
      config,
    );

    expect(result.xdr).toBeDefined();
    expect(result.txHash).toBeDefined();
    expect(result.txHash).toBeInstanceOf(Buffer);

    // Parse the XDR to verify structure
    const { TransactionBuilder } = await import('@stellar/stellar-sdk');
    const tx = TransactionBuilder.fromXDR(result.xdr, Networks.TESTNET);

    expect(tx.operations.length).toBe(4);
    expect(tx.operations[0].type).toBe('beginSponsoringFutureReserves');
    expect(tx.operations[1].type).toBe('createAccount');
    expect(tx.operations[2].type).toBe('changeTrust');
    expect(tx.operations[3].type).toBe('endSponsoringFutureReserves');
  });

  it('sets correct sources on operations', async () => {
    const result = await buildSponsorshipTransaction(
      agentKeypair.publicKey(),
      channel,
      config,
    );

    const { TransactionBuilder } = await import('@stellar/stellar-sdk');
    const tx = TransactionBuilder.fromXDR(result.xdr, Networks.TESTNET);

    // Transaction source is channel
    expect(tx.source).toBe(channelKeypair.publicKey());

    // Op 0, 1 source is sponsor
    expect(tx.operations[0].source).toBe(sponsorKeypair.publicKey());
    expect(tx.operations[1].source).toBe(sponsorKeypair.publicKey());

    // Op 2, 3 source is agent
    expect(tx.operations[2].source).toBe(agentKeypair.publicKey());
    expect(tx.operations[3].source).toBe(agentKeypair.publicKey());
  });

  it('uses 1 stroop starting balance', async () => {
    const result = await buildSponsorshipTransaction(
      agentKeypair.publicKey(),
      channel,
      config,
    );

    const { TransactionBuilder } = await import('@stellar/stellar-sdk');
    const tx = TransactionBuilder.fromXDR(result.xdr, Networks.TESTNET);

    const createOp = tx.operations[1] as any;
    expect(createOp.startingBalance).toBe('0.0000001');
  });

  it('sets correct USDC asset', async () => {
    const result = await buildSponsorshipTransaction(
      agentKeypair.publicKey(),
      channel,
      config,
    );

    const { TransactionBuilder } = await import('@stellar/stellar-sdk');
    const tx = TransactionBuilder.fromXDR(result.xdr, Networks.TESTNET);

    const trustOp = tx.operations[2] as any;
    expect(trustOp.line.code).toBe('USDC');
    expect(trustOp.line.issuer).toBe(usdcIssuer);
  });

  it('returns unsigned XDR (no signatures)', async () => {
    const result = await buildSponsorshipTransaction(
      agentKeypair.publicKey(),
      channel,
      config,
    );

    const { TransactionBuilder } = await import('@stellar/stellar-sdk');
    const tx = TransactionBuilder.fromXDR(result.xdr, Networks.TESTNET);

    expect(tx.signatures.length).toBe(0);
  });
});
