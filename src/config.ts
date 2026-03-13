import { Keypair, Networks } from '@stellar/stellar-sdk';
import 'dotenv/config';

export interface Config {
  network: 'testnet' | 'public';
  networkPassphrase: string;
  sponsorKeypair: Keypair;
  sponsorPublicKey: string;
  channelKeypairs: Keypair[];
  horizonUrl: string;
  explorerUrl: string;
  usdcIssuer: string;
  port: number;
  rateLimitPerIpWindowMs: number;
  rateLimitPerIpMax: number;
  channelReservationTtlMs: number;
  maxTxFee: number;
  maxStartingBalance: number;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function loadConfig(): Config {
  const network = requireEnv('NETWORK') as 'testnet' | 'public';
  if (network !== 'testnet' && network !== 'public') {
    throw new Error(`NETWORK must be "testnet" or "public", got "${network}"`);
  }

  const networkPassphrase =
    network === 'testnet' ? Networks.TESTNET : Networks.PUBLIC;

  const sponsorKeypair = Keypair.fromSecret(requireEnv('SPONSOR_SECRET_KEY'));

  const channelSecrets = requireEnv('CHANNEL_SECRET_KEYS')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (channelSecrets.length === 0) {
    throw new Error('CHANNEL_SECRET_KEYS must contain at least one key');
  }

  const channelKeypairs = channelSecrets.map((secret) => {
    try {
      return Keypair.fromSecret(secret);
    } catch {
      throw new Error(`Invalid channel secret key at position ${channelSecrets.indexOf(secret) + 1}`);
    }
  });

  const usdcIssuer = requireEnv('USDC_ISSUER');

  return {
    network,
    networkPassphrase,
    sponsorKeypair,
    sponsorPublicKey: sponsorKeypair.publicKey(),
    channelKeypairs,
    horizonUrl: requireEnv('HORIZON_URL'),
    explorerUrl: requireEnv('EXPLORER_URL'),
    usdcIssuer,
    port: parseInt(process.env.PORT || '3000', 10),
    rateLimitPerIpWindowMs: parseInt(
      process.env.RATE_LIMIT_PER_IP_WINDOW_MS || '3600000',
      10,
    ),
    rateLimitPerIpMax: parseInt(process.env.RATE_LIMIT_PER_IP_MAX || '5', 10),
    channelReservationTtlMs: parseInt(
      process.env.CHANNEL_RESERVATION_TTL_MS || '30000',
      10,
    ),
    maxTxFee: parseInt(process.env.MAX_TX_FEE || '10000', 10),
    maxStartingBalance: parseInt(process.env.MAX_STARTING_BALANCE || '0', 10),
  };
}
