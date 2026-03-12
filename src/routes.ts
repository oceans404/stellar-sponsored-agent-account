import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { StrKey, TransactionBuilder, Transaction } from '@stellar/stellar-sdk';
import type { Config } from './config.js';
import type { ChannelPool, Channel } from './channel-pool.js';
import type { RateLimiter } from './rate-limit.js';
import {
  ValidationError,
  NotFoundError,
  ServiceError,
} from './errors.js';
import {
  buildSponsorshipTransaction,
  submitSponsorshipTransaction,
  checkAccountExists,
  getSponsorBalance,
} from './sponsor.js';
import { validateSignedXdr } from './validate.js';
import {
  CreateRequestSchema,
  CreateResponseSchema,
  SubmitRequestSchema,
  SubmitResponseSchema,
  InfoResponseSchema,
  HealthResponseSchema,
  ErrorResponseSchema,
} from './schemas.js';

export interface Reservation {
  channelPublicKey: string;
  agentPublicKey: string;
  txHash: Buffer;
  channel: Channel;
  createdAt: number;
  expiresAt: number;
}

interface AppState {
  config: Config;
  channelPool: ChannelPool;
  rateLimiter: RateLimiter;
  reservations: Map<string, Reservation>;
}

function log(data: Record<string, unknown>) {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), ...data }));
}

function getClientIp(c: any): string {
  return (
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    'unknown'
  );
}

// --- Route definitions ---

const createRoute_ = createRoute({
  method: 'post',
  path: '/create',
  operationId: 'createSponsorshipTransaction',
  summary: 'Request a sponsored account transaction',
  description:
    'Builds an unsigned 4-operation sponsorship transaction for the given ' +
    'agent public key. The agent should inspect the returned XDR, sign it, ' +
    'and send it back via POST /submit.',
  request: {
    body: { content: { 'application/json': { schema: CreateRequestSchema } } },
  },
  responses: {
    200: {
      description: 'Unsigned transaction ready for agent signing',
      content: { 'application/json': { schema: CreateResponseSchema } },
    },
    400: {
      description: 'Validation failed',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
    429: {
      description: 'Rate limit exceeded',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
    503: {
      description: 'No channel accounts available',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
});

const submitRoute = createRoute({
  method: 'post',
  path: '/submit',
  operationId: 'submitSignedTransaction',
  summary: 'Submit the agent-signed transaction',
  description:
    "Validates the agent's signature, adds the sponsor and channel account " +
    'signatures, and submits the fully signed transaction to the Stellar network.',
  request: {
    body: { content: { 'application/json': { schema: SubmitRequestSchema } } },
  },
  responses: {
    201: {
      description: 'Account created successfully',
      content: { 'application/json': { schema: SubmitResponseSchema } },
    },
    400: {
      description: 'Validation failed',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
    404: {
      description: 'No pending reservation found',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
    502: {
      description: 'Stellar network submission failure',
      content: { 'application/json': { schema: ErrorResponseSchema } },
    },
  },
});

const infoRoute = createRoute({
  method: 'get',
  path: '/info',
  operationId: 'getServiceInfo',
  summary: 'Service configuration',
  description:
    "Returns the service's public configuration. Agents can use this to " +
    'verify the sponsor account, USDC issuer, and network before starting ' +
    'the onboarding flow.',
  responses: {
    200: {
      description: 'Service info',
      content: { 'application/json': { schema: InfoResponseSchema } },
    },
  },
});

const healthRoute = createRoute({
  method: 'get',
  path: '/health',
  operationId: 'getHealth',
  summary: 'Health check',
  description: 'Service health with sponsor balance and channel pool status.',
  responses: {
    200: {
      description: 'Health status',
      content: { 'application/json': { schema: HealthResponseSchema } },
    },
  },
});

// --- App factory ---

export function createApp(state: AppState) {
  const { config, channelPool, rateLimiter, reservations } = state;

  const app = new OpenAPIHono();

  // Request body size limit (64KB)
  app.use('*', async (c, next) => {
    const contentLength = c.req.header('content-length');
    if (contentLength && parseInt(contentLength, 10) > 65_536) {
      return c.json(
        { status: 'error' as const, code: 'VALIDATION_FAILED' as const, message: 'Request body too large', retryable: false },
        413,
      );
    }
    await next();
  });

  // POST /create
  app.openapi(createRoute_, async (c) => {
    const startTime = Date.now();
    const ip = getClientIp(c);
    const { public_key: publicKey } = c.req.valid('json');

    // 1. Validate public key format
    if (!StrKey.isValidEd25519PublicKey(publicKey)) {
      throw new ValidationError('Invalid Stellar public key');
    }

    // 2. Rate limit by IP
    rateLimiter.checkIp(ip);

    // 3. Check public key not already sponsored
    rateLimiter.checkPublicKey(publicKey);

    // 4. Check account doesn't already exist
    const exists = await checkAccountExists(publicKey, config);
    if (exists) {
      throw new ValidationError('Account already exists on the network');
    }

    // 5. Clean up any existing reservation for this agent
    for (const [key, res] of reservations) {
      if (res.agentPublicKey === publicKey) {
        reservations.delete(key);
        channelPool.release(res.channel);
      }
    }

    // 6. Acquire channel
    const channel = await channelPool.acquire();

    try {
      // 7. Build unsigned transaction
      const { xdr, txHash } = await buildSponsorshipTransaction(
        publicKey,
        channel,
        config,
      );

      // 8. Store reservation
      const txHashHex = txHash.toString('hex');
      const now = Date.now();
      reservations.set(txHashHex, {
        channelPublicKey: channel.publicKey,
        agentPublicKey: publicKey,
        txHash,
        channel,
        createdAt: now,
        expiresAt: now + config.channelReservationTtlMs,
      });

      log({
        op: 'create',
        agentPublicKey: publicKey,
        channelPublicKey: channel.publicKey,
        latencyMs: Date.now() - startTime,
      });

      return c.json(
        {
          xdr,
          network_passphrase: config.networkPassphrase,
        },
        200,
      );
    } catch (err) {
      channelPool.release(channel);
      throw err;
    }
  });

  // POST /submit
  app.openapi(submitRoute, async (c) => {
    const startTime = Date.now();
    const { xdr: xdrString } = c.req.valid('json');

    // 1. Parse XDR to get hash for reservation lookup
    let parsedTx: Transaction;
    try {
      const parsed = TransactionBuilder.fromXDR(xdrString, config.networkPassphrase);
      parsedTx = parsed as Transaction;
    } catch {
      throw new ValidationError('Failed to parse XDR');
    }

    // Find reservation by channel public key (transaction source)
    const txSource = parsedTx.source;

    let reservation: Reservation | undefined;
    let reservationKey: string | undefined;
    for (const [key, res] of reservations) {
      if (res.channelPublicKey === txSource) {
        reservation = res;
        reservationKey = key;
        break;
      }
    }

    if (!reservation || !reservationKey) {
      throw new NotFoundError(
        'No pending reservation found. It may have expired.',
      );
    }

    // Check expiration
    if (Date.now() > reservation.expiresAt) {
      reservations.delete(reservationKey);
      channelPool.release(reservation.channel);
      throw new NotFoundError('Reservation has expired');
    }

    // 2. Full validation
    const validatedTx = validateSignedXdr(xdrString, reservation, config);

    // 3. Check account doesn't exist (race condition guard)
    const exists = await checkAccountExists(reservation.agentPublicKey, config);
    if (exists) {
      reservations.delete(reservationKey);
      channelPool.release(reservation.channel);
      throw new ValidationError('Account already exists on the network');
    }

    // 4. Sign and submit
    try {
      const result = await submitSponsorshipTransaction(
        validatedTx,
        reservation.channel,
        config,
      );

      // 5. Record sponsorship
      rateLimiter.recordSponsorship(reservation.agentPublicKey);

      // 6. Cleanup
      reservations.delete(reservationKey);
      channelPool.release(reservation.channel);

      log({
        op: 'submit',
        agentPublicKey: reservation.agentPublicKey,
        hash: result.hash,
        ledger: result.ledger,
        latencyMs: Date.now() - startTime,
      });

      return c.json(
        {
          status: 'ok' as const,
          hash: result.hash,
          ledger: result.ledger,
          agent_public_key: reservation.agentPublicKey,
          explorer_url: `${config.explorerUrl}/tx/${result.hash}`,
        },
        201,
      );
    } catch (err) {
      reservations.delete(reservationKey);
      channelPool.release(reservation.channel);
      throw err;
    }
  });

  // GET /info
  app.openapi(infoRoute, async (c) => {
    const balance = await getSponsorBalance(config);
    return c.json(
      {
        sponsor_public_key: config.sponsorPublicKey,
        sponsor_balance_xlm: balance,
        network_passphrase: config.networkPassphrase,
        usdc_issuer: config.usdcIssuer,
        horizon_url: config.horizonUrl,
        explorer_url: config.explorerUrl,
        available_channels: channelPool.availableCount(),
        api_docs: '/openapi.json',
      agent_skill: '/SKILL.md',
      },
      200,
    );
  });

  // GET /health
  app.openapi(healthRoute, async (c) => {
    const balance = await getSponsorBalance(config);
    return c.json(
      {
        status: 'ok' as const,
        network: config.network,
        sponsor_public_key: config.sponsorPublicKey,
        sponsor_balance_xlm: balance,
        channels: {
          total: channelPool.totalCount(),
          available: channelPool.availableCount(),
        },
        pending_reservations: reservations.size,
      },
      200,
    );
  });

  // GET /openapi.json — auto-generated from route definitions
  // GET /SKILL.md
  app.get('/SKILL.md', (c) => {
    const proto = c.req.header('x-forwarded-proto') || 'http';
    const host = c.req.header('host') || `localhost:${config.port}`;
    const baseUrl = `${proto}://${host}`;

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const template = readFileSync(join(__dirname, 'SKILL.md'), 'utf-8');
    const ttlSeconds = Math.round(config.channelReservationTtlMs / 1000);
    const content = template
      .replaceAll('{{BASE_URL}}', baseUrl)
      .replaceAll('{{NETWORK}}', config.network)
      .replaceAll('{{EXPLORER_URL}}', config.explorerUrl)
      .replaceAll('{{RESERVATION_TTL_SECONDS}}', String(ttlSeconds));

    c.header('Content-Type', 'text/markdown; charset=utf-8');
    return c.body(content);
  });

  // GET /openapi.json — auto-generated from route definitions
  app.doc('/openapi.json', {
    openapi: '3.1.0',
    info: {
      title: 'Stellar Sponsored Agent Account',
      description:
        'Give any AI agent a Stellar USDC wallet in two API calls. ' +
        'No prior balance needed. Costs 1 XLM per account, covered by the service operator.\n\n' +
        '## Flow\n' +
        '1. `POST /create` — request an unsigned sponsorship transaction\n' +
        '2. Inspect and sign the returned XDR locally\n' +
        '3. `POST /submit` — send the signed XDR back for submission to the network',
      version: '1.0.0',
    },
  });

  // Global error handler
  app.onError((err, c) => {
    if (err instanceof ServiceError) {
      log({
        op: 'error',
        code: err.code,
        message: err.message,
        statusCode: err.statusCode,
      });
      return c.json(err.toJSON(), err.statusCode as any);
    }

    log({
      op: 'error',
      code: 'INTERNAL_ERROR',
      message: err.message,
    });

    return c.json(
      {
        status: 'error',
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        retryable: false,
      },
      500,
    );
  });

  return app;
}
