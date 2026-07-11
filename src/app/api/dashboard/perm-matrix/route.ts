// src/app/api/dashboard/perm-matrix/route.ts
// GET — the READ-ONLY 权限矩阵 (brief §3.1): live role_grants (roles × modules),
// active-account count per role, and the role's centre-scope convention (from
// volunteers.scope). No edit surface exists ANYWHERE for grants — 调整权限由
// 架构师经连接器执行并记录审计 (self-lockout protection). Gate: settings ≥ edit.

import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

export async function GET() {
  const access = await requireModuleAccess('settings', 'edit');
  if (!access.ok) {
    return NextResponse.json(
      { error: access.status === 401 ? 'Unauthorized' : 'Forbidden' },
      { status: access.status }
    );
  }
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const [{ data: grants, error: gErr }, { data: vols, error: vErr }] = await Promise.all([
    supabaseAdmin.from('role_grants').select('role, module, access'),
    supabaseAdmin.from('volunteers').select('role, scope, active'),
  ]);
  if (gErr || vErr) {
    console.error('[perm-matrix] load failed:', gErr ?? vErr);
    return NextResponse.json({ error: 'Failed to load matrix' }, { status: 500 });
  }

  // Active-account count + observed scope per role (volunteers.scope convention;
  // mixed scopes surface as 'mixed' so drift is visible, not hidden).
  const perRole = new Map<string, { count: number; scopes: Set<string> }>();
  for (const v of (vols ?? []) as { role: string; scope: string | null; active: boolean }[]) {
    const r = perRole.get(v.role) ?? { count: 0, scopes: new Set<string>() };
    if (v.active) {
      r.count++;
      r.scopes.add(v.scope ?? 'own_center');
    }
    perRole.set(v.role, r);
  }

  const roles = [...new Set((grants ?? []).map((g) => g.role as string))].sort();
  const rows = roles.map((role) => {
    const mods: Record<string, string> = {};
    for (const g of (grants ?? []) as { role: string; module: string; access: string }[]) {
      if (g.role === role) mods[g.module] = g.access;
    }
    const info = perRole.get(role);
    const scopes = info ? [...info.scopes] : [];
    return {
      role,
      grants: mods,
      activeCount: info?.count ?? 0,
      scope: scopes.length === 0 ? null : scopes.length > 1 ? 'mixed' : scopes[0],
    };
  });

  return NextResponse.json({ roles: rows });
}
