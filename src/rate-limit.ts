import { RateLimitError } from './errors.js';

export interface RateLimiter {
  checkIp(ip: string): void;
  checkPublicKey(publicKey: string): void;
  recordSponsorship(publicKey: string): void;
  destroy(): void;
}

export function createRateLimiter(
  windowMs: number,
  maxPerWindow: number,
): RateLimiter {
  const ipTimestamps = new Map<string, number[]>();
  const sponsoredKeys = new Set<string>();

  // Periodic cleanup of stale IP entries
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [ip, timestamps] of ipTimestamps) {
      const valid = timestamps.filter((t) => now - t < windowMs);
      if (valid.length === 0) {
        ipTimestamps.delete(ip);
      } else {
        ipTimestamps.set(ip, valid);
      }
    }
  }, 60_000);

  return {
    checkIp(ip: string): void {
      const now = Date.now();
      const timestamps = ipTimestamps.get(ip) || [];
      const valid = timestamps.filter((t) => now - t < windowMs);

      if (valid.length >= maxPerWindow) {
        throw new RateLimitError(
          'Rate limit exceeded. Try again later.',
        );
      }

      valid.push(now);
      ipTimestamps.set(ip, valid);
    },

    checkPublicKey(publicKey: string): void {
      if (sponsoredKeys.has(publicKey)) {
        throw new RateLimitError(
          'This public key has already been sponsored.',
        );
      }
    },

    recordSponsorship(publicKey: string): void {
      sponsoredKeys.add(publicKey);
    },

    destroy(): void {
      clearInterval(cleanupInterval);
    },
  };
}
