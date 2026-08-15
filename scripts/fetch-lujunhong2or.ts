// scripts/fetch-lujunhong2or.ts
// Polite structured export of lujunhong2or.com (corpus Phase A, Task 1).
// WordPress 6.6.7 with an open REST API — we use /wp-json/wp/v2, NOT HTML
// scraping, and honor the site's robots.txt Crawl-delay: 20 (>=20s between
// network requests). The client identifies itself with a project UA string.
//
//   npx tsx scripts/fetch-lujunhong2or.ts               # full export (cached pages skipped)
//   npx tsx scripts/fetch-lujunhong2or.ts --after       # incremental: after recorded max wp date
//   npx tsx scripts/fetch-lujunhong2or.ts --after=2026-08-01T00:00:00  # explicit cutoff
//   npx tsx scripts/fetch-lujunhong2or.ts --refresh     # ignore page cache, refetch everything
//
// Outputs (COMMITTED — the source of everything injected, same principle as
// scripts/upload-canonical-libai.ts):
//   corpus-sources/lujunhong2or/letters-YYYYMMDD.json
//   corpus-sources/lujunhong2or/fahui-qa-YYYYMMDD.json
//   corpus-sources/lujunhong2or/state.json   (max wp date per category, for the monthly sync)
//
// Resumability: every fetched page is cached under scripts/data/ (gitignored);
// a full page (100 posts, orderby=date&order=asc → stable content) is never
// refetched, so an interrupted or repeated run only refetches the final,
// still-growing page.

import * as fs from 'fs';
import * as path from 'path';
import { decodeEntities } from './lujunhong2or-parse';

const SITE = 'https://lujunhong2or.com';
const UA = 'xlfm-wisdom-corpus-bot/1.0 (+https://xlfm-wisdom.vercel.app; contact: englihken@gmail.com)';
const CRAWL_DELAY_MS = 20_000; // robots.txt Crawl-delay: 20
const PER_PAGE = 100;
const FIELDS = 'id,slug,link,title,date,modified,content';

const OUT_DIR = path.join(__dirname, '..', 'corpus-sources', 'lujunhong2or');
const CACHE_DIR = path.join(__dirname, 'data', 'lujunhong2or-cache');
const STATE_FILE = path.join(OUT_DIR, 'state.json');

// Category names as they appear (decoded) in /wp/v2/categories; IDs are
// resolved live by name, per the brief (currently 2047 and 2046).
const SOURCES = [
  { key: 'letters', file: 'letters', categoryName: '开示解答来信疑惑' },
  { key: 'fahui', file: 'fahui-qa', categoryName: '法会弟子提问' },
] as const;

interface State {
  [categoryName: string]: {
    categoryId: number;
    max_wp_date: string;      // max post.date seen across all runs
    last_fetch: string;       // ISO timestamp of the run
    last_snapshot: string;    // file the last run wrote (or '' if no new posts)
    total_posts_seen: number; // count in the last full/incremental sweep
  };
}

// Transport is curl, not Node fetch: the site sits behind Cloudflare, whose
// managed challenge fingerprints Node's TLS stack (undici gets a 403 "Just a
// moment…" page) while curl with our UA passes. curl ships with Windows 10+.
let lastRequestAt = 0;
async function politeFetch(url: string): Promise<{ status: number; body: string }> {
  const wait = lastRequestAt + CRAWL_DELAY_MS - Date.now();
  if (wait > 0) {
    process.stdout.write(`  (crawl-delay ${Math.ceil(wait / 1000)}s…)\n`);
    await new Promise((r) => setTimeout(r, wait));
  }
  lastRequestAt = Date.now();
  const { execFileSync } = await import('child_process');
  const out = execFileSync(
    'curl',
    ['-sS', '--max-time', '120', '-A', UA, '-w', '\n__HTTP_STATUS:%{http_code}', url],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  );
  const marker = out.lastIndexOf('\n__HTTP_STATUS:');
  if (marker < 0) throw new Error(`GET ${url} → no status marker in curl output`);
  const status = parseInt(out.slice(marker + '\n__HTTP_STATUS:'.length), 10);
  const body = out.slice(0, marker);
  if (status !== 200) throw new Error(`GET ${url} → ${status} ${body.slice(0, 500)}`);
  return { status, body };
}

async function resolveCategoryIds(): Promise<Map<string, { id: number; count: number }>> {
  const res = await politeFetch(`${SITE}/wp-json/wp/v2/categories?per_page=100`);
  const cats = JSON.parse(res.body) as { id: number; name: string; count: number }[];
  const byName = new Map<string, { id: number; count: number }>();
  for (const c of cats) byName.set(decodeEntities(c.name).trim(), { id: c.id, count: c.count });
  return byName;
}

async function fetchCategory(
  categoryId: number,
  cacheKey: string,
  after: string | null,
  refresh: boolean
): Promise<any[]> {
  const posts: any[] = [];
  const afterParam = after ? `&after=${encodeURIComponent(after)}` : '';
  for (let page = 1; ; page++) {
    // Cache key includes the after-cutoff so incremental runs never reuse
    // full-export pages (and vice versa).
    const cacheFile = path.join(
      CACHE_DIR,
      `${cacheKey}${after ? `-after-${after.replace(/[:]/g, '')}` : ''}-p${page}.json`
    );
    let pagePosts: any[] | null = null;
    if (!refresh && fs.existsSync(cacheFile)) {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      // Only full pages are stable under orderby=date&order=asc; a partial
      // (final) page grows as the series publishes, so refetch it.
      if (cached.length === PER_PAGE) {
        pagePosts = cached;
        console.log(`  page ${page}: ${cached.length} posts (cache)`);
      }
    }
    if (pagePosts === null) {
      const url =
        `${SITE}/wp-json/wp/v2/posts?categories=${categoryId}&per_page=${PER_PAGE}` +
        `&page=${page}&orderby=date&order=asc&_fields=${FIELDS}${afterParam}`;
      let body: string;
      try {
        body = (await politeFetch(url)).body;
      } catch (e: any) {
        // WP returns 400 rest_post_invalid_page_number when page exceeds the
        // total — with the ?after= filter TotalPages isn't known up front.
        if (String(e.message).includes('rest_post_invalid_page_number')) break;
        throw e;
      }
      pagePosts = JSON.parse(body) as any[];
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify(pagePosts));
      console.log(`  page ${page}: ${pagePosts.length} posts (fetched)`);
    }
    posts.push(...pagePosts);
    if (pagePosts.length < PER_PAGE) break;
  }
  return posts;
}

async function main() {
  const args = process.argv.slice(2);
  const refresh = args.includes('--refresh');
  const afterArg = args.find((a) => a === '--after' || a.startsWith('--after='));

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const state: State = fs.existsSync(STATE_FILE)
    ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
    : {};

  console.log('Resolving category IDs by name…');
  const cats = await resolveCategoryIds();

  const today = new Date();
  const ymd = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;

  for (const src of SOURCES) {
    const cat = cats.get(src.categoryName);
    if (!cat) throw new Error(`category not found by name: ${src.categoryName}`);

    // --after → explicit cutoff, or the recorded max wp date from state.json.
    let after: string | null = null;
    if (afterArg) {
      const explicit = afterArg.includes('=') ? afterArg.split('=')[1] : null;
      after = explicit ?? state[src.categoryName]?.max_wp_date ?? null;
      if (!after) throw new Error(`--after given but no recorded max_wp_date for ${src.categoryName}; run a full export first`);
    }

    console.log(`\n=== ${src.categoryName} (id ${cat.id}, ~${cat.count} posts)${after ? ` after ${after}` : ''} ===`);
    const posts = await fetchCategory(cat.id, src.key, after, refresh);
    console.log(`  → ${posts.length} posts total`);

    const maxDate = posts.reduce((m, p) => (p.date > m ? p.date : m), state[src.categoryName]?.max_wp_date ?? '');
    let snapshotFile = '';
    if (posts.length > 0) {
      snapshotFile = `${src.file}-${ymd}.json`;
      const snapshot = {
        source: 'lujunhong2or.com',
        category: src.categoryName,
        categoryId: cat.id,
        fetched_at: new Date().toISOString(),
        after,
        count: posts.length,
        max_wp_date: maxDate,
        posts,
      };
      fs.writeFileSync(path.join(OUT_DIR, snapshotFile), JSON.stringify(snapshot, null, 1));
      console.log(`  ✓ wrote corpus-sources/lujunhong2or/${snapshotFile}`);
    } else {
      console.log('  no new posts — no snapshot written');
    }

    state[src.categoryName] = {
      categoryId: cat.id,
      max_wp_date: maxDate,
      last_fetch: new Date().toISOString(),
      last_snapshot: snapshotFile,
      total_posts_seen: posts.length,
    };
  }

  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  console.log(`\n✓ state written to corpus-sources/lujunhong2or/state.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
