import { describe, it, expect, afterEach } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import { createChannelPool } from '../src/channel-pool.js';
import { UnavailableError } from '../src/errors.js';

function makeKeypairs(n: number) {
  return Array.from({ length: n }, () => Keypair.random());
}

describe('ChannelPool', () => {
  let pool: ReturnType<typeof createChannelPool>;

  afterEach(() => {
    pool?.destroy();
  });

  it('acquires and releases channels', async () => {
    const keypairs = makeKeypairs(2);
    pool = createChannelPool(keypairs);

    expect(pool.availableCount()).toBe(2);
    expect(pool.totalCount()).toBe(2);

    const ch1 = await pool.acquire();
    expect(pool.availableCount()).toBe(1);

    const ch2 = await pool.acquire();
    expect(pool.availableCount()).toBe(0);

    pool.release(ch1);
    expect(pool.availableCount()).toBe(1);

    pool.release(ch2);
    expect(pool.availableCount()).toBe(2);
  });

  it('waits for a channel when pool is exhausted', async () => {
    pool = createChannelPool(makeKeypairs(1));

    const ch = await pool.acquire();
    expect(pool.availableCount()).toBe(0);

    // Start acquiring — should block
    const acquirePromise = pool.acquire(500);

    // Release after a short delay
    setTimeout(() => pool.release(ch), 50);

    const ch2 = await acquirePromise;
    expect(ch2.publicKey).toBe(ch.publicKey);
  });

  it('throws UnavailableError on timeout', async () => {
    pool = createChannelPool(makeKeypairs(1));
    await pool.acquire();

    await expect(pool.acquire(50)).rejects.toThrow(UnavailableError);
  });

  it('releaseAll returns all channels', async () => {
    pool = createChannelPool(makeKeypairs(3));

    await pool.acquire();
    await pool.acquire();
    await pool.acquire();
    expect(pool.availableCount()).toBe(0);

    pool.releaseAll();
    expect(pool.availableCount()).toBe(3);
  });

  it('does not duplicate channels on double release', async () => {
    pool = createChannelPool(makeKeypairs(1));
    const ch = await pool.acquire();

    pool.release(ch);
    pool.release(ch);

    expect(pool.availableCount()).toBe(1);
  });
});
