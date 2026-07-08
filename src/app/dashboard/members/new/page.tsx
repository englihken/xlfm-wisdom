// src/app/dashboard/members/new/page.tsx
// 新增会员 — the shared MemberForm in create mode. members:edit required.

'use client';

import { ErpGate } from '@/components/erp-gate';
import { MemberForm } from '@/components/member-form';
import { grantAllows } from '@/lib/access';

export default function NewMemberPage() {
  return (
    <ErpGate active="members" titleSuffix="新增">
      {(me) =>
        grantAllows(me.grants, 'members', 'edit') ? (
          <MemberForm mode="create" />
        ) : (
          <p className="max-w-3xl mx-auto px-4 py-10 text-sm text-ink-muted">您没有新增会员的权限。</p>
        )
      }
    </ErpGate>
  );
}
