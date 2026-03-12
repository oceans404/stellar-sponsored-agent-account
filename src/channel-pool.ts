import { Keypair } from '@stellar/stellar-sdk';
import { UnavailableError } from './errors.js';

export interface Channel {
  keypair: Keypair;
  publicKey: string;
}

export interface ChannelPool {
  acquire(timeoutMs?: number): Promise<Channel>;
  release(channel: Channel): void;
  releaseAll(): void;
  availableCount(): number;
  totalCount(): number;
  destroy(): void;
}

interface Waiter {
  resolve: (channel: Channel) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export function createChannelPool(keypairs: Keypair[]): ChannelPool {
  const available: Channel[] = keypairs.map((kp) => ({
    keypair: kp,
    publicKey: kp.publicKey(),
  }));
  const allChannels = [...available];
  const waiters: Waiter[] = [];

  return {
    acquire(timeoutMs = 10_000): Promise<Channel> {
      const channel = available.pop();
      if (channel) {
        return Promise.resolve(channel);
      }

      return new Promise<Channel>((resolve, reject) => {
        const timer = setTimeout(() => {
          const idx = waiters.findIndex((w) => w.resolve === resolve);
          if (idx !== -1) waiters.splice(idx, 1);
          reject(
            new UnavailableError(
              'No channel accounts available. Try again later.',
            ),
          );
        }, timeoutMs);

        waiters.push({ resolve, reject, timer });
      });
    },

    release(channel: Channel): void {
      if (waiters.length > 0) {
        const waiter = waiters.shift()!;
        clearTimeout(waiter.timer);
        waiter.resolve(channel);
      } else {
        // Only push back if not already in the available pool
        if (!available.some((c) => c.publicKey === channel.publicKey)) {
          available.push(channel);
        }
      }
    },

    releaseAll(): void {
      for (const ch of allChannels) {
        if (!available.some((c) => c.publicKey === ch.publicKey)) {
          available.push(ch);
        }
      }
      // Resolve any waiters
      while (waiters.length > 0 && available.length > 0) {
        const waiter = waiters.shift()!;
        clearTimeout(waiter.timer);
        waiter.resolve(available.pop()!);
      }
    },

    availableCount(): number {
      return available.length;
    },

    totalCount(): number {
      return allChannels.length;
    },

    destroy(): void {
      for (const waiter of waiters) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error('Pool destroyed'));
      }
      waiters.length = 0;
    },
  };
}
