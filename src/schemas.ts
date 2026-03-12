import { z } from '@hono/zod-openapi';

// --- Request schemas ---

export const CreateRequestSchema = z
  .object({
    public_key: z.string().openapi({
      description: "The agent's Stellar public key (G...)",
      example: 'GABC123...',
    }),
  })
  .openapi('CreateRequest');

export const SubmitRequestSchema = z
  .object({
    xdr: z.string().openapi({
      description: 'Agent-signed transaction XDR (base64)',
    }),
  })
  .openapi('SubmitRequest');

// --- Response schemas ---

export const CreateResponseSchema = z
  .object({
    xdr: z.string().openapi({
      description: 'Unsigned transaction XDR (base64)',
    }),
    network_passphrase: z.string().openapi({
      description: 'Stellar network passphrase for signing',
      example: 'Test SDF Network ; September 2015',
    }),
  })
  .openapi('CreateResponse');

export const SubmitResponseSchema = z
  .object({
    status: z.literal('ok'),
    hash: z.string().openapi({
      description: 'Transaction hash on the Stellar network',
    }),
    ledger: z.number().int().openapi({
      description: 'Ledger number the transaction was included in',
    }),
    agent_public_key: z.string().openapi({
      description: "The agent's Stellar public key",
    }),
    explorer_url: z.string().openapi({
      description: 'Link to the transaction on the Stellar explorer',
    }),
  })
  .openapi('SubmitResponse');

export const InfoResponseSchema = z
  .object({
    sponsor_public_key: z.string().openapi({
      description: 'Sponsor account public key',
    }),
    sponsor_balance_xlm: z.string().openapi({
      description: 'Sponsor account XLM balance',
    }),
    network_passphrase: z.string().openapi({
      description: 'Stellar network passphrase',
    }),
    usdc_issuer: z.string().openapi({
      description: 'USDC asset issuer public key',
    }),
    horizon_url: z.string().openapi({
      description: 'Horizon server URL',
    }),
    explorer_url: z.string().openapi({
      description: 'Stellar explorer base URL',
    }),
    available_channels: z.number().int().openapi({
      description: 'Number of channel accounts available for concurrent requests',
    }),
    api_docs: z.string().openapi({
      description: 'Path to the OpenAPI spec',
    }),
    agent_skill: z.string().openapi({
      description: 'Path to the agent skill document (instructions for AI agents)',
    }),
  })
  .openapi('InfoResponse');

export const HealthResponseSchema = z
  .object({
    status: z.literal('ok'),
    network: z.enum(['testnet', 'public']),
    sponsor_public_key: z.string(),
    sponsor_balance_xlm: z.string(),
    channels: z.object({
      total: z.number().int(),
      available: z.number().int(),
    }),
    pending_reservations: z.number().int(),
  })
  .openapi('HealthResponse');

export const ErrorResponseSchema = z
  .object({
    status: z.literal('error'),
    code: z.enum([
      'VALIDATION_FAILED',
      'RATE_LIMITED',
      'NOT_FOUND',
      'HORIZON_ERROR',
      'SERVICE_UNAVAILABLE',
      'INTERNAL_ERROR',
    ]).openapi({
      description: 'Machine-readable error code',
    }),
    message: z.string().openapi({
      description: 'Human-readable error description',
    }),
    retryable: z.boolean().openapi({
      description: 'Whether the client should retry the request',
    }),
  })
  .openapi('ErrorResponse');
