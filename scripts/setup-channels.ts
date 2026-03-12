import {
  Keypair,
  Horizon,
  TransactionBuilder,
  Operation,
  Networks,
} from '@stellar/stellar-sdk';

const args = process.argv.slice(2);
const countIdx = args.indexOf('--count');
const sponsorIdx = args.indexOf('--sponsor-secret');
const networkIdx = args.indexOf('--network');

const count = countIdx !== -1 ? parseInt(args[countIdx + 1], 10) : 5;
const sponsorSecret = sponsorIdx !== -1 ? args[sponsorIdx + 1] : undefined;
const network = networkIdx !== -1 ? args[networkIdx + 1] : 'testnet';

if (!sponsorSecret) {
  console.error('Usage: npx tsx scripts/setup-channels.ts --sponsor-secret S... [--count 5] [--network testnet]');
  process.exit(1);
}

const networkPassphrase = network === 'public' ? Networks.PUBLIC : Networks.TESTNET;
const horizonUrl =
  network === 'public'
    ? 'https://horizon.stellar.org'
    : 'https://horizon-testnet.stellar.org';

async function main() {
  const sponsorKeypair = Keypair.fromSecret(sponsorSecret!);
  const server = new Horizon.Server(horizonUrl);

  console.log(`Creating ${count} channel accounts on ${network}...`);
  console.log(`Sponsor: ${sponsorKeypair.publicKey()}`);
  console.log();

  const channelKeypairs: Keypair[] = [];

  for (let i = 0; i < count; i++) {
    const channelKeypair = Keypair.random();
    channelKeypairs.push(channelKeypair);

    const sponsorAccount = await server.loadAccount(sponsorKeypair.publicKey());

    const transaction = new TransactionBuilder(sponsorAccount, {
      fee: '100',
      networkPassphrase,
    })
      .addOperation(
        Operation.createAccount({
          destination: channelKeypair.publicKey(),
          startingBalance: '2', // 1 XLM base reserve + 1 XLM buffer for fees
        }),
      )
      .setTimeout(30)
      .build();

    transaction.sign(sponsorKeypair);

    try {
      await server.submitTransaction(transaction);
      console.log(`Channel ${i + 1}/${count}: ${channelKeypair.publicKey()}`);
    } catch (error: any) {
      const codes = error?.response?.data?.extras?.result_codes;
      console.error(`Failed to create channel ${i + 1}:`, codes || error.message);
      process.exit(1);
    }
  }

  console.log();
  console.log('Add this to your .env:');
  console.log();
  console.log(
    `CHANNEL_SECRET_KEYS=${channelKeypairs.map((kp) => kp.secret()).join(',')}`,
  );
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
