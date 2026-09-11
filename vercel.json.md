# vercel.json — notes

`vercel.json` must stay strict JSON (Vercel rejects comments and unknown keys), so the reasoning lives here.

## `"regions": ["syd1"]` (2026-09-11, batch 2 §5)

**Why:** the Supabase database is in `ap-southeast-2` (Sydney) and visitors are in Malaysia (edge `sin1`). Before the pin, functions executed in `iad1` (US East, the default), so every Supabase round trip crossed the Pacific — a homepage chip hit (5 serial DB calls) took 2.4–2.8 s. Pinned to `syd1` the same hit takes 0.5–0.9 s. Pinecone (`us-east-1`) and the Anthropic API are US-hosted; from Sydney they cost ~150–200 ms more per call, which is small against a 10–30 s model turn, and the measured retrieval stage was unchanged (2.4 s vs 2.6–3.5 s).

**Rollback:** delete the `regions` line and redeploy. Verify with `curl -sD - -o /dev/null -X POST https://xlfm-wisdom.vercel.app/api/chat --data '{bad' | grep X-Vercel-Id` — the second segment is the function region (`sin1::syd1::…`).

## `crons`

Two entries — the Hobby plan limit. Anything else that needs a schedule (chip refresh, dead-letter sweep, rate-limit pruning) is chained inside `/api/cron/review`.
