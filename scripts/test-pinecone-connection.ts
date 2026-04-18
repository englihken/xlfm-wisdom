import { Pinecone } from '@pinecone-database/pinecone';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function test() {
  const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
  const index = pc.index('xlfm-wisdom');
  const stats = await index.describeIndexStats();
  console.log('Current index stats:', stats);
  console.log('Total vectors:', stats.totalRecordCount);
  console.log('Namespaces:', Object.keys(stats.namespaces || {}));
}

test().catch(console.error);
