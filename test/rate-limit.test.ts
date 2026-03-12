import { describe, it, expect, afterEach } from 'vitest';
import { createRateLimiter } from '../src/rate-limit.js';
import { RateLimitError } from '../src/errors.js';

describe('RateLimiter', () => {
  let limiter: ReturnType<typeof createRateLimiter>;

  afterEach(() => {
    limiter?.destroy();
  });

  describe('IP rate limiting', () => {
    it('allows requests within limit', () => {
      limiter = createRateLimiter(60_000, 3);

      expect(() => limiter.checkIp('1.2.3.4')).not.toThrow();
      expect(() => limiter.checkIp('1.2.3.4')).not.toThrow();
      expect(() => limiter.checkIp('1.2.3.4')).not.toThrow();
    });

    it('rejects requests over limit', () => {
      limiter = createRateLimiter(60_000, 2);

      limiter.checkIp('1.2.3.4');
      limiter.checkIp('1.2.3.4');
      expect(() => limiter.checkIp('1.2.3.4')).toThrow(RateLimitError);
    });

    it('tracks IPs independently', () => {
      limiter = createRateLimiter(60_000, 1);

      limiter.checkIp('1.2.3.4');
      expect(() => limiter.checkIp('5.6.7.8')).not.toThrow();
    });

    it('allows requests after window expires', async () => {
      limiter = createRateLimiter(50, 1);

      limiter.checkIp('1.2.3.4');
      expect(() => limiter.checkIp('1.2.3.4')).toThrow(RateLimitError);

      await new Promise((r) => setTimeout(r, 60));
      expect(() => limiter.checkIp('1.2.3.4')).not.toThrow();
    });
  });

  describe('Public key dedup', () => {
    it('allows unsponsored key', () => {
      limiter = createRateLimiter(60_000, 10);
      expect(() => limiter.checkPublicKey('GABC')).not.toThrow();
    });

    it('rejects already-sponsored key', () => {
      limiter = createRateLimiter(60_000, 10);
      limiter.recordSponsorship('GABC');
      expect(() => limiter.checkPublicKey('GABC')).toThrow(RateLimitError);
    });

    it('tracks keys independently', () => {
      limiter = createRateLimiter(60_000, 10);
      limiter.recordSponsorship('GABC');
      expect(() => limiter.checkPublicKey('GDEF')).not.toThrow();
    });
  });
});
