// One-off smoke test for the Message Batches surface the summarize cron uses:
// create → retrieve (poll) → results streaming. No DB involved.
//   npx tsx scripts/smoke-batch-api.ts
import Anthropic from '@anthropic-ai/sdk';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

async function main() {
  const batch = await anthropic.messages.batches.create({
    requests: [
      {
        custom_id: 'smoke',
        params: {
          model: 'claude-haiku-4-5',
          max_tokens: 16,
          messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
        },
      },
    ],
  });
  console.log(`created ${batch.id} status=${batch.processing_status}`);

  const deadline = Date.now() + 4 * 60 * 1000;
  let status = batch.processing_status;
  while (status !== 'ended' && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000));
    status = (await anthropic.messages.batches.retrieve(batch.id)).processing_status;
    console.log(`  poll: ${status}`);
  }
  if (status !== 'ended') throw new Error('batch did not end within 4min (fine for prod, fail for smoke)');

  for await (const entry of await anthropic.messages.batches.results(batch.id)) {
    if (entry.result.type !== 'succeeded') throw new Error(`request ${entry.custom_id}: ${entry.result.type}`);
    const text = entry.result.message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    console.log(`  result[${entry.custom_id}]: ${JSON.stringify(text)}`);
  }
  console.log('SMOKE PASS');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
