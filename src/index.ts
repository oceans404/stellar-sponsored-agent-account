import { serve } from '@hono/node-server';
import { loadConfig } from './config.js';
import { createChannelPool } from './channel-pool.js';
import { createRateLimiter } from './rate-limit.js';
import { createApp, type Reservation } from './routes.js';
import { getSponsorBalance } from './sponsor.js';

function log(data: Record<string, unknown>) {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), ...data }));
}

async function main() {
  const config = loadConfig();

  log({
    op: 'startup',
    network: config.network,
    sponsorPublicKey: config.sponsorPublicKey,
    channelCount: config.channelKeypairs.length,
    horizonUrl: config.horizonUrl,
  });

  const channelPool = createChannelPool(config.channelKeypairs);
  const rateLimiter = createRateLimiter(
    config.rateLimitPerIpWindowMs,
    config.rateLimitPerIpMax,
  );
  const reservations = new Map<string, Reservation>();

  // Periodic reservation cleanup (every 10s)
  const reservationCleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, reservation] of reservations) {
      if (now > reservation.expiresAt) {
        reservations.delete(key);
        channelPool.release(reservation.channel);
        log({
          op: 'reservation_expired',
          agentPublicKey: reservation.agentPublicKey,
          channelPublicKey: reservation.channelPublicKey,
        });
      }
    }
  }, 10_000);

  // Periodic sponsor balance check (every 5 min)
  const balanceCheck = setInterval(async () => {
    const balance = await getSponsorBalance(config);
    const balanceNum = parseFloat(balance);
    if (!isNaN(balanceNum) && balanceNum < 10) {
      log({
        op: 'balance_warning',
        sponsorBalance: balance,
        message: 'Sponsor account balance is low',
      });
    }
  }, 300_000);

  const app = createApp({ config, channelPool, rateLimiter, reservations });

  const server = serve({
    fetch: app.fetch,
    port: config.port,
  });

  log({ op: 'listening', port: config.port });

  // Graceful shutdown
  const shutdown = async () => {
    log({ op: 'shutdown', message: 'Received shutdown signal' });

    clearInterval(reservationCleanup);
    clearInterval(balanceCheck);

    // Release all channels
    channelPool.releaseAll();
    channelPool.destroy();
    rateLimiter.destroy();

    // Close server with timeout
    const closeTimeout = setTimeout(() => {
      log({ op: 'shutdown', message: 'Forced shutdown after timeout' });
      process.exit(1);
    }, 10_000);

    server.close(() => {
      clearTimeout(closeTimeout);
      log({ op: 'shutdown', message: 'Server closed gracefully' });
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
