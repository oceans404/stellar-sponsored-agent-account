import { describe, it, expect } from 'vitest';
import {
  Keypair,
  TransactionBuilder,
  Operation,
  Asset,
  Networks,
  Account,
  FeeBumpTransaction,
  Memo,
} from '@stellar/stellar-sdk';
import { validateSignedXdr } from '../src/validate.js';
import { ValidationError } from '../src/errors.js';
import type { Config } from '../src/config.js';
import type { Reservation } from '../src/routes.js';

const networkPassphrase = Networks.TESTNET;
const sponsorKeypair = Keypair.random();
const channelKeypair = Keypair.random();
const agentKeypair = Keypair.random();
const usdcIssuer = Keypair.random().publicKey();

const config: Config = {
  network: 'testnet',
  networkPassphrase,
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
  maxStartingBalance: 0,
};

function buildValidTransaction() {
  const channelAccount = new Account(channelKeypair.publicKey(), '100');
  const tx = new TransactionBuilder(channelAccount, {
    fee: '100',
    networkPassphrase,
  })
    .addOperation(
      Operation.beginSponsoringFutureReserves({
        sponsoredId: agentKeypair.publicKey(),
        source: sponsorKeypair.publicKey(),
      }),
    )
    .addOperation(
      Operation.createAccount({
        destination: agentKeypair.publicKey(),
        startingBalance: '0',
        source: sponsorKeypair.publicKey(),
      }),
    )
    .addOperation(
      Operation.changeTrust({
        asset: new Asset('USDC', usdcIssuer),
        source: agentKeypair.publicKey(),
      }),
    )
    .addOperation(
      Operation.endSponsoringFutureReserves({
        source: agentKeypair.publicKey(),
      }),
    )
    .setTimeout(300)
    .build();

  return tx;
}

function makeReservation(tx: ReturnType<typeof buildValidTransaction>): Reservation {
  return {
    channelPublicKey: channelKeypair.publicKey(),
    agentPublicKey: agentKeypair.publicKey(),
    txHash: tx.hash(),
    channel: { keypair: channelKeypair, publicKey: channelKeypair.publicKey() },
    createdAt: Date.now(),
    expiresAt: Date.now() + 60000,
  };
}

function signAndSerialize(tx: ReturnType<typeof buildValidTransaction>) {
  tx.sign(agentKeypair);
  return tx.toXDR();
}

describe('validateSignedXdr', () => {
  it('accepts a valid signed transaction', () => {
    const tx = buildValidTransaction();
    const reservation = makeReservation(tx);
    const xdr = signAndSerialize(tx);

    const result = validateSignedXdr(xdr, reservation, config);
    expect(result).toBeDefined();
    expect(result.operations.length).toBe(4);
  });

  it('rejects invalid XDR', () => {
    const tx = buildValidTransaction();
    const reservation = makeReservation(tx);

    expect(() => validateSignedXdr('not-valid-xdr', reservation, config)).toThrow(
      ValidationError,
    );
  });

  it('rejects wrong number of operations', () => {
    const channelAccount = new Account(channelKeypair.publicKey(), '100');
    const tx = new TransactionBuilder(channelAccount, {
      fee: '100',
      networkPassphrase,
    })
      .addOperation(
        Operation.beginSponsoringFutureReserves({
          sponsoredId: agentKeypair.publicKey(),
          source: sponsorKeypair.publicKey(),
        }),
      )
      .addOperation(
        Operation.endSponsoringFutureReserves({
          source: agentKeypair.publicKey(),
        }),
      )
      .setTimeout(300)
      .build();

    const reservation = makeReservation(tx);
    tx.sign(agentKeypair);

    expect(() => validateSignedXdr(tx.toXDR(), reservation, config)).toThrow(
      'Expected 4 operations',
    );
  });

  it('rejects wrong operation order', () => {
    const channelAccount = new Account(channelKeypair.publicKey(), '100');
    const tx = new TransactionBuilder(channelAccount, {
      fee: '100',
      networkPassphrase,
    })
      .addOperation(
        Operation.createAccount({
          destination: agentKeypair.publicKey(),
          startingBalance: '0',
          source: sponsorKeypair.publicKey(),
        }),
      )
      .addOperation(
        Operation.beginSponsoringFutureReserves({
          sponsoredId: agentKeypair.publicKey(),
          source: sponsorKeypair.publicKey(),
        }),
      )
      .addOperation(
        Operation.changeTrust({
          asset: new Asset('USDC', usdcIssuer),
          source: agentKeypair.publicKey(),
        }),
      )
      .addOperation(
        Operation.endSponsoringFutureReserves({
          source: agentKeypair.publicKey(),
        }),
      )
      .setTimeout(300)
      .build();

    const reservation = makeReservation(tx);
    tx.sign(agentKeypair);

    expect(() => validateSignedXdr(tx.toXDR(), reservation, config)).toThrow(
      'not in the correct order',
    );
  });

  it('rejects wrong transaction source', () => {
    const wrongChannel = Keypair.random();
    const wrongAccount = new Account(wrongChannel.publicKey(), '100');
    const tx = new TransactionBuilder(wrongAccount, {
      fee: '100',
      networkPassphrase,
    })
      .addOperation(
        Operation.beginSponsoringFutureReserves({
          sponsoredId: agentKeypair.publicKey(),
          source: sponsorKeypair.publicKey(),
        }),
      )
      .addOperation(
        Operation.createAccount({
          destination: agentKeypair.publicKey(),
          startingBalance: '0',
          source: sponsorKeypair.publicKey(),
        }),
      )
      .addOperation(
        Operation.changeTrust({
          asset: new Asset('USDC', usdcIssuer),
          source: agentKeypair.publicKey(),
        }),
      )
      .addOperation(
        Operation.endSponsoringFutureReserves({
          source: agentKeypair.publicKey(),
        }),
      )
      .setTimeout(300)
      .build();

    const reservation = makeReservation(tx);
    tx.sign(agentKeypair);

    expect(() => validateSignedXdr(tx.toXDR(), reservation, config)).toThrow(
      'Transaction source does not match',
    );
  });

  it('rejects excessive fee', () => {
    const channelAccount = new Account(channelKeypair.publicKey(), '100');
    const tx = new TransactionBuilder(channelAccount, {
      fee: '999999',
      networkPassphrase,
    })
      .addOperation(
        Operation.beginSponsoringFutureReserves({
          sponsoredId: agentKeypair.publicKey(),
          source: sponsorKeypair.publicKey(),
        }),
      )
      .addOperation(
        Operation.createAccount({
          destination: agentKeypair.publicKey(),
          startingBalance: '0',
          source: sponsorKeypair.publicKey(),
        }),
      )
      .addOperation(
        Operation.changeTrust({
          asset: new Asset('USDC', usdcIssuer),
          source: agentKeypair.publicKey(),
        }),
      )
      .addOperation(
        Operation.endSponsoringFutureReserves({
          source: agentKeypair.publicKey(),
        }),
      )
      .setTimeout(300)
      .build();

    const reservation = makeReservation(tx);
    tx.sign(agentKeypair);

    expect(() => validateSignedXdr(tx.toXDR(), reservation, config)).toThrow(
      'fee',
    );
  });

  it('rejects excessive starting balance', () => {
    const channelAccount = new Account(channelKeypair.publicKey(), '100');
    const tx = new TransactionBuilder(channelAccount, {
      fee: '100',
      networkPassphrase,
    })
      .addOperation(
        Operation.beginSponsoringFutureReserves({
          sponsoredId: agentKeypair.publicKey(),
          source: sponsorKeypair.publicKey(),
        }),
      )
      .addOperation(
        Operation.createAccount({
          destination: agentKeypair.publicKey(),
          startingBalance: '100',
          source: sponsorKeypair.publicKey(),
        }),
      )
      .addOperation(
        Operation.changeTrust({
          asset: new Asset('USDC', usdcIssuer),
          source: agentKeypair.publicKey(),
        }),
      )
      .addOperation(
        Operation.endSponsoringFutureReserves({
          source: agentKeypair.publicKey(),
        }),
      )
      .setTimeout(300)
      .build();

    const reservation = makeReservation(tx);
    tx.sign(agentKeypair);

    expect(() => validateSignedXdr(tx.toXDR(), reservation, config)).toThrow(
      'Starting balance',
    );
  });

  it('rejects wrong USDC issuer', () => {
    const wrongIssuer = Keypair.random().publicKey();
    const channelAccount = new Account(channelKeypair.publicKey(), '100');
    const tx = new TransactionBuilder(channelAccount, {
      fee: '100',
      networkPassphrase,
    })
      .addOperation(
        Operation.beginSponsoringFutureReserves({
          sponsoredId: agentKeypair.publicKey(),
          source: sponsorKeypair.publicKey(),
        }),
      )
      .addOperation(
        Operation.createAccount({
          destination: agentKeypair.publicKey(),
          startingBalance: '0',
          source: sponsorKeypair.publicKey(),
        }),
      )
      .addOperation(
        Operation.changeTrust({
          asset: new Asset('USDC', wrongIssuer),
          source: agentKeypair.publicKey(),
        }),
      )
      .addOperation(
        Operation.endSponsoringFutureReserves({
          source: agentKeypair.publicKey(),
        }),
      )
      .setTimeout(300)
      .build();

    const reservation = makeReservation(tx);
    tx.sign(agentKeypair);

    expect(() => validateSignedXdr(tx.toXDR(), reservation, config)).toThrow(
      'USDC',
    );
  });

  it('rejects wrong agent signature', () => {
    const tx = buildValidTransaction();
    const reservation = makeReservation(tx);

    // Sign with wrong key
    const wrongKey = Keypair.random();
    tx.sign(wrongKey);

    expect(() => validateSignedXdr(tx.toXDR(), reservation, config)).toThrow(
      'signature verification failed',
    );
  });

  it('rejects transaction with multiple signatures', () => {
    const tx = buildValidTransaction();
    const reservation = makeReservation(tx);

    tx.sign(agentKeypair);
    tx.sign(sponsorKeypair); // extra signature

    expect(() => validateSignedXdr(tx.toXDR(), reservation, config)).toThrow(
      'Expected exactly 1 signature',
    );
  });

  it('rejects unsigned transaction', () => {
    const tx = buildValidTransaction();
    const reservation = makeReservation(tx);

    // Don't sign
    expect(() => validateSignedXdr(tx.toXDR(), reservation, config)).toThrow(
      'Expected exactly 1 signature',
    );
  });

  it('rejects transaction with memo', () => {
    const channelAccount = new Account(channelKeypair.publicKey(), '100');
    const tx = new TransactionBuilder(channelAccount, {
      fee: '100',
      networkPassphrase,
      memo: Memo.text('sneaky'),
    })
      .addOperation(
        Operation.beginSponsoringFutureReserves({
          sponsoredId: agentKeypair.publicKey(),
          source: sponsorKeypair.publicKey(),
        }),
      )
      .addOperation(
        Operation.createAccount({
          destination: agentKeypair.publicKey(),
          startingBalance: '0',
          source: sponsorKeypair.publicKey(),
        }),
      )
      .addOperation(
        Operation.changeTrust({
          asset: new Asset('USDC', usdcIssuer),
          source: agentKeypair.publicKey(),
        }),
      )
      .addOperation(
        Operation.endSponsoringFutureReserves({
          source: agentKeypair.publicKey(),
        }),
      )
      .setTimeout(300)
      .build();

    const reservation = makeReservation(tx);
    tx.sign(agentKeypair);

    expect(() => validateSignedXdr(tx.toXDR(), reservation, config)).toThrow(
      'no memo',
    );
  });

  it('rejects wrong operation source on beginSponsoring', () => {
    const wrongSponsor = Keypair.random();
    const channelAccount = new Account(channelKeypair.publicKey(), '100');
    const tx = new TransactionBuilder(channelAccount, {
      fee: '100',
      networkPassphrase,
    })
      .addOperation(
        Operation.beginSponsoringFutureReserves({
          sponsoredId: agentKeypair.publicKey(),
          source: wrongSponsor.publicKey(),
        }),
      )
      .addOperation(
        Operation.createAccount({
          destination: agentKeypair.publicKey(),
          startingBalance: '0',
          source: sponsorKeypair.publicKey(),
        }),
      )
      .addOperation(
        Operation.changeTrust({
          asset: new Asset('USDC', usdcIssuer),
          source: agentKeypair.publicKey(),
        }),
      )
      .addOperation(
        Operation.endSponsoringFutureReserves({
          source: agentKeypair.publicKey(),
        }),
      )
      .setTimeout(300)
      .build();

    const reservation = makeReservation(tx);
    tx.sign(agentKeypair);

    expect(() => validateSignedXdr(tx.toXDR(), reservation, config)).toThrow(
      'source must be sponsor',
    );
  });
});
