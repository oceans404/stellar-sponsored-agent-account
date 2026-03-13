import {
  Horizon,
  TransactionBuilder,
  Operation,
  Asset,
  Keypair,
  Transaction,
} from '@stellar/stellar-sdk';
import type { Config } from './config.js';
import type { Channel } from './channel-pool.js';
import { HorizonError, ValidationError } from './errors.js';

export interface BuildResult {
  xdr: string;
  txHash: Buffer;
}

export async function buildSponsorshipTransaction(
  agentPublicKey: string,
  channel: Channel,
  config: Config,
): Promise<BuildResult> {
  const server = new Horizon.Server(config.horizonUrl);

  let channelAccount;
  try {
    channelAccount = await server.loadAccount(channel.publicKey);
  } catch (error: any) {
    if (error?.response?.status === 404) {
      throw new HorizonError(
        `Channel account ${channel.publicKey} not found on network. Run setup-channels.ts first.`,
      );
    }
    throw new HorizonError('Failed to load channel account from Horizon');
  }

  const transaction = new TransactionBuilder(channelAccount, {
    fee: '100',
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(
      Operation.beginSponsoringFutureReserves({
        sponsoredId: agentPublicKey,
        source: config.sponsorPublicKey,
      }),
    )
    .addOperation(
      Operation.createAccount({
        destination: agentPublicKey,
        startingBalance: '0',
        source: config.sponsorPublicKey,
      }),
    )
    .addOperation(
      Operation.changeTrust({
        asset: new Asset('USDC', config.usdcIssuer),
        source: agentPublicKey,
      }),
    )
    .addOperation(
      Operation.endSponsoringFutureReserves({
        source: agentPublicKey,
      }),
    )
    .setTimeout(300) // 5 minutes
    .build();

  return {
    xdr: transaction.toXDR(),
    txHash: transaction.hash(),
  };
}

export async function submitSponsorshipTransaction(
  transaction: Transaction,
  channel: Channel,
  config: Config,
): Promise<{ hash: string; ledger: number }> {
  // Add sponsor and channel signatures
  transaction.sign(config.sponsorKeypair);
  transaction.sign(channel.keypair);

  const server = new Horizon.Server(config.horizonUrl);

  try {
    const result = await server.submitTransaction(transaction);
    return {
      hash: result.hash,
      ledger: result.ledger,
    };
  } catch (error: any) {
    const resultCodes = error?.response?.data?.extras?.result_codes;

    if (resultCodes) {
      const txCode = resultCodes.transaction;
      const opCodes = resultCodes.operations;

      if (txCode === 'tx_bad_seq') {
        throw new HorizonError(
          'Transaction sequence number conflict',
          resultCodes,
        );
      }

      if (txCode === 'tx_insufficient_balance') {
        throw new HorizonError('Sponsor account underfunded', resultCodes);
      }

      if (txCode === 'tx_bad_auth') {
        throw new ValidationError('Transaction signature verification failed on network');
      }

      if (opCodes?.includes('op_already_exists')) {
        throw new ValidationError('Account already exists on the network');
      }

      throw new HorizonError(
        `Horizon submission failed: ${txCode}`,
        resultCodes,
      );
    }

    throw new HorizonError(
      error.message || 'Horizon submission failed',
    );
  }
}

export async function checkAccountExists(
  publicKey: string,
  config: Config,
): Promise<boolean> {
  const server = new Horizon.Server(config.horizonUrl);
  try {
    await server.loadAccount(publicKey);
    return true;
  } catch (error: any) {
    if (error?.response?.status === 404) {
      return false;
    }
    throw new HorizonError('Failed to check account existence');
  }
}

export async function getSponsorBalance(config: Config): Promise<string> {
  const server = new Horizon.Server(config.horizonUrl);
  try {
    const account = await server.loadAccount(config.sponsorPublicKey);
    const nativeBalance = account.balances.find(
      (b: any) => b.asset_type === 'native',
    );
    return nativeBalance ? (nativeBalance as any).balance : '0';
  } catch {
    return 'unknown';
  }
}
