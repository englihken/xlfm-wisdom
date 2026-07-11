// src/app/m/page.tsx
// PUBLIC 共修会事务来信 — E3: now a SERVER component that checks org_settings
// public.inbox_form_enabled before rendering the client form and passes the
// optional inbox_form_notice down (brief §3.5). FAIL-OPEN: a missing key or
// unreachable table renders the form as before; only an explicit false shows
// the gentle 暂停 page — never an error.

import { isPublicPageEnabled, loadInboxFormNotice } from '@/lib/org-settings';
import { PublicPageClosed } from '@/components/public-page-closed';
import { MailFormClient } from './mail-form-client';

export const dynamic = 'force-dynamic';

export default async function MailFormPage() {
  const enabled = await isPublicPageEnabled('public.inbox_form_enabled');
  if (!enabled) return <PublicPageClosed />;
  const notice = await loadInboxFormNotice();
  return <MailFormClient notice={notice} />;
}
