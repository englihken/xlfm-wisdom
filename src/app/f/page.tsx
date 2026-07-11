// src/app/f/page.tsx
// PUBLIC 会员月费自查 — E3: now a SERVER component that checks org_settings
// public.fee_check_enabled before rendering the client form (brief §3.5).
// FAIL-OPEN: a missing key or unreachable table renders the form as before;
// only an explicit false shows the gentle 暂停 page — never an error.

import { isPublicPageEnabled } from '@/lib/org-settings';
import { PublicPageClosed } from '@/components/public-page-closed';
import { FeeLookupClient } from './fee-lookup-client';

export const dynamic = 'force-dynamic';

export default async function FeeLookupPage() {
  const enabled = await isPublicPageEnabled('public.fee_check_enabled');
  if (!enabled) return <PublicPageClosed />;
  return <FeeLookupClient />;
}
