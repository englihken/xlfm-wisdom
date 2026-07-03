This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Scheduled jobs (Vercel Cron)

`vercel.json` defines the cron schedule. Currently one job:

- **`/api/cron/summarize`** — daily auto-summary. Once a conversation has been idle
  2+ hours, it folds that conversation into an evolving care summary on the
  contact (`contacts.summary`). Scheduled at `0 16 * * *` (16:00 UTC = 00:00 MYT),
  so volunteers see fresh 摘要 each morning.

**Auth:** the endpoint requires `Authorization: Bearer <CRON_SECRET>`. Set
`CRON_SECRET` in Vercel (Sensitive, Production) — Vercel Cron sends it
automatically. Without a matching env var the endpoint returns 401.

**Hobby-plan note:** on the Vercel Hobby plan, cron jobs run **once per day within
an hour of the scheduled time** (not to the exact minute). That imprecision is
fine here — the summary just needs to be ready by morning.

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
