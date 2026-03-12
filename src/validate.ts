import {
  TransactionBuilder,
  FeeBumpTransaction,
  Transaction,
  Keypair,
  Memo,
} from '@stellar/stellar-sdk';
import { ValidationError } from './errors.js';
import type { Config } from './config.js';
import type { Reservation } from './routes.js';

export function validateSignedXdr(
  xdrString: string,
  reservation: Reservation,
  config: Config,
): Transaction {
  // 1. Parse XDR
  let parsed;
  try {
    parsed = TransactionBuilder.fromXDR(xdrString, config.networkPassphrase);
  } catch {
    throw new ValidationError('Failed to parse XDR');
  }

  // 2. Must be Transaction, not FeeBumpTransaction
  if (parsed instanceof FeeBumpTransaction) {
    throw new ValidationError('FeeBumpTransaction not allowed');
  }

  const transaction = parsed as Transaction;

  // 3. Transaction source must be the expected channel account
  if (transaction.source !== reservation.channelPublicKey) {
    throw new ValidationError('Transaction source does not match expected channel account');
  }

  // 4. Fee within configured max
  if (parseInt(transaction.fee, 10) > config.maxTxFee) {
    throw new ValidationError(
      `Transaction fee ${transaction.fee} exceeds maximum ${config.maxTxFee}`,
    );
  }

  // 5. Memo must be MemoNone
  if (transaction.memo.type !== 'none') {
    throw new ValidationError('Transaction must have no memo');
  }

  // 6. Time bounds check — if maxTime is set, must be reasonable
  if (transaction.timeBounds?.maxTime) {
    const maxTime = parseInt(transaction.timeBounds.maxTime, 10);
    // Allow up to 10 minutes from now
    const tenMinutesFromNow = Math.floor(Date.now() / 1000) + 600;
    if (maxTime !== 0 && maxTime > tenMinutesFromNow) {
      throw new ValidationError('Transaction maxTime is too far in the future');
    }
  }

  // 7. Exactly 4 operations
  const ops = transaction.operations;
  if (ops.length !== 4) {
    throw new ValidationError(
      `Expected 4 operations, found ${ops.length}`,
    );
  }

  // 8. Operation types in correct order
  if (
    ops[0].type !== 'beginSponsoringFutureReserves' ||
    ops[1].type !== 'createAccount' ||
    ops[2].type !== 'changeTrust' ||
    ops[3].type !== 'endSponsoringFutureReserves'
  ) {
    throw new ValidationError('Operations are not in the correct order or type');
  }

  // 9. Operation sources correct
  if (ops[0].source !== config.sponsorPublicKey) {
    throw new ValidationError('beginSponsoringFutureReserves source must be sponsor');
  }
  if (ops[1].source !== config.sponsorPublicKey) {
    throw new ValidationError('createAccount source must be sponsor');
  }
  if (ops[2].source !== reservation.agentPublicKey) {
    throw new ValidationError('changeTrust source must be agent');
  }
  if (ops[3].source !== reservation.agentPublicKey) {
    throw new ValidationError('endSponsoringFutureReserves source must be agent');
  }

  // 10. beginSponsoring sponsoredId matches agent
  if (
    ops[0].type === 'beginSponsoringFutureReserves' &&
    ops[0].sponsoredId !== reservation.agentPublicKey
  ) {
    throw new ValidationError('sponsoredId does not match agent public key');
  }

  // 11. createAccount destination matches agent
  if (ops[1].type === 'createAccount' && ops[1].destination !== reservation.agentPublicKey) {
    throw new ValidationError('createAccount destination does not match agent public key');
  }

  // 12. startingBalance within configured max
  if (ops[1].type === 'createAccount') {
    const startingBalanceStroops =
      parseFloat(ops[1].startingBalance) * 10_000_000;
    if (startingBalanceStroops > config.maxStartingBalance) {
      throw new ValidationError(
        `Starting balance ${ops[1].startingBalance} exceeds maximum`,
      );
    }
  }

  // 13. changeTrust asset matches configured USDC
  if (ops[2].type === 'changeTrust') {
    const line = ops[2].line;
    if (
      !('code' in line) ||
      !('issuer' in line) ||
      line.code !== 'USDC' ||
      line.issuer !== config.usdcIssuer
    ) {
      throw new ValidationError('changeTrust asset does not match configured USDC');
    }
  }

  // 14. changeTrust limit — absent (defaults to max) or > 0
  if (ops[2].type === 'changeTrust' && ops[2].limit !== undefined) {
    const limit = parseFloat(ops[2].limit);
    if (limit <= 0) {
      throw new ValidationError('changeTrust limit must be positive');
    }
  }

  // 15. Exactly 1 signature (the agent's)
  if (transaction.signatures.length !== 1) {
    throw new ValidationError(
      `Expected exactly 1 signature, found ${transaction.signatures.length}`,
    );
  }

  // 16. Cryptographically verify agent signature
  const agentKeypair = Keypair.fromPublicKey(reservation.agentPublicKey);
  const txHash = transaction.hash();
  const sigBytes = transaction.signatures[0].signature();

  if (!agentKeypair.verify(txHash, sigBytes)) {
    throw new ValidationError('Agent signature verification failed');
  }

  return transaction;
}
