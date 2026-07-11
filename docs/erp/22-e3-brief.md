# XLFM ERP — E3 施工 brief · 报表中心 + 设置扩建 (meeting-first visual dashboard)

**For Claude Code (repo at d48e9c9).** Architect applied migration 032 (5 'reports' grants + 5 org_settings keys — verified live). App code only. Follow repo conventions (route handlers, service-role client, audit helper, uniform-404 walls, Chinese UI). Where a named file doesn't match repo reality, follow the repo and keep the behavior contract.

## 0. E3 RULE — i18n-ready from day one
Create `src/lib/i18n.ts` exporting `t(key: string): string` over a zh dictionary `src/lib/locales/zh.ts` (plain object, dot-namespaced keys e.g. `reports.pack.title`). Locale hardcoded 'zh' this phase; missing key returns the key (dev-visible). EVERY new user-facing string in E3 code goes through t(). Existing screens untouched. Zero visible change.

## 1. Visualization system (BINDING — dataviz-validated)
- **Palette (all four accessibility checks pass on white cards — do not alter)**: categorical fixed order emerald `#009E63` → azure `#0E86D4` → amber `#D97706` → violet `#7C5CDB`; neutral fold-其他 `#A79E8B`; **rose `#B04A4A` reserved for status/crisis only, always with icon+label, never color-alone**. Funnel = emerald sequential ramp `#C6F2DF→#7FE3B8→#2FC488→#009E63→#00744A` with ink text `#33302A` on the two lightest steps. Delta-up chips + positive heroes = emerald. App chrome (nav gold, chips, escalation text) stays house gold — vibrant colors are for DATA MARKS only.
- **Mark specs**: lines 2px + ≥8px endpoint marker + end-value direct label; bars 4px rounded data-ends, 2px surface gaps between adjacent fills; gridlines 1px #EEE8DB, 3–4 ticks, recessive; legend chips whenever ≥2 series (single series: no legend, title names it); values/labels always in ink tokens, never series color; NO dual axes; NO chart libraries — hand-rolled inline SVG (pptxgenjs is the ONLY new dependency, used solely for export).
- **Components** in `src/components/charts/`: `TrendLine` (≤2 series), `Donut` (≤4 named + 其他 fold, center hero number), `HBars` (direct labels; optional `track` variant for vs-capacity), `FunnelBars` (sequential ramp, conversion % rows between bars), `ProgressRing`, `GroupedBars`, plus a `StatTile` with delta chip (▲ emerald / — muted). Every chart: hover tooltip layer (absolutely-positioned HTML tooltip per mark) + a small 表格 toggle swapping the chart for a plain table of the same data (accessibility relief). All labels via t().
- Deltas only on aggregate tiles; per-centre visuals stay 随喜 tone — name-sorted, never ranked, no deltas.

## 2. 报表中心 — monthly review pack (rebuilds /dashboard/reports)
Gate: role_grants module **'reports'** (admin=admin; erp_admin/committee/finance_director=view national; centre_head=view own-centre slice — per-centre visuals collapse to their row/ring, 关怀 and 财务 pages hidden for them, inbox health = own mailbox; uniform 404 beyond). The 报表 nav door re-gates onto these grants. Existing care-report queries RELOCATE into page 2 — keep their logic.

**API**: `GET /api/reports/pack?month=YYYY-MM` — ALL numbers server-assembled in one response, scope-aware (no client fan-out). MYT month boundaries. Month chips = last 6 + current, default current.
Definitions (source of truth):
- 新结缘 (month) = contact_milestones first_contact with happened_on in month. Delta vs previous month.
- 开始念经 (month) = started_chanting milestones in month (use the EXISTING milestone keys from src/lib/outreach.ts — do not invent). 发心义工 = its milestone count in the funnel window.
- Trend = last 6 months of the two series above.
- 来源分布 = source_type of contacts whose first_contact is in month (fold nulls/smallest into 其他).
- Funnel = milestone counts over rolling `org_settings outreach.event_window_days` (default 90).
- 活动效果 = per published event: 报名 (registrations), 新结缘 (contacts.source_event_id), 开始念经≤window (started_chanting within window of event end among that event's contacts), 转化 % chip. NO 出席 column — footnote 「现场签到功能未建」.
- 随喜各会 = per-centre 新结缘/开始念经 (contacts.centre_id), name-sorted.
- 关怀 page: 对话量 = conversations created in month (+delta); 危机 = crisis_flag in month (rose + ⚠); 经聊天新结缘 = source_type='chat' first_contact in month; 问题分布 = category distribution of month's conversations, top 5 + 其他 fold.
- 运营·财务 page: 活跃会员 count; 收缴率 ProgressRing (reuse existing finance coverage logic); 收入 (fee_payments + 随喜)/支出/结余 for month; GroupedBars 6mo 收支 (收入 emerald, 支出 amber); HBars 各会收缴率 (footnote 无逾期无催缴可豁免). 0-data blocks render 淡显 with a gentle note, never crash.
- 活动·库存 page: HBars-track 报名 vs 名额 per open event (azure); 低库存 bars 当前/警戒线 (rose + ⚠, reuse existing threshold logic); 盘点差异 count; 放行拍照 count for month.
- 收件箱健康 page: reuse /api/inbox/health shape + 平均首次回复 tile (avg first_response_at−created_at, threads created last 30d) + the >surface_hq_days list (subject+age only).
**CSV**: `GET /api/reports/pack.csv?month=&page=` flat rows per page (quiet link in UI).

**演示模式**: button → document.documentElement.requestFullscreen() + body class: hide nav/chrome/filters, one dept page per slide with big serif title 「{emoji} {部门} · {YYYY年M月}」, ←/→/PageUp/PageDown navigate, floating dot-pill navigator, ESC exits (also handle fullscreenchange). Hero numbers scale to ~44px. This IS the meeting deck.

**导出 PPT**: client-side **pptxgenjs** (dynamic import so it never enters the main bundle): title slide (月度检讨包 · YYYY年M月 · 心灵法门马来西亚) + one slide per dept page — hero numbers as text + NATIVE pptx charts (bar/line/doughnut) in the binding palette, footer page numbers. Filename 月度检讨包-YYYY-MM.pptx. **打印**: print CSS — hide chrome, page-break-after per dept page, B/W-legible.

## 3. 设置扩建
**Page gate change (Ken decision)**: settings page opens to settings≥edit (admin + erp_admin); the 义工与账号 section renders for admin ONLY. Section-gate, don't fork the page.
New generic API: `GET/PATCH /api/dashboard/org-settings` with a hard ALLOWLIST of keys (care.categories, care.ai_draft_enabled, outreach.event_window_days, public.fee_check_enabled, public.inbox_form_enabled, public.inbox_form_notice); PATCH audits module='settings' action='settings_updated' with before/after. Gate settings≥edit.
1. **权限矩阵** — READ-ONLY: matrix from live role_grants (roles × modules, access chips, scope column from volunteers.scope convention, active-member count per role). Note under table: 调整权限由架构师经连接器执行并记录审计. No edit controls.
2. **审计查看器** — `GET /api/dashboard/audit?module=&action=&actor=&from=&to=&q=&page=` (gate: module 'audit' ≥ view): 50/page latest-first, filter row, record_id/email search, expandable before/after JSON. Banner: 只可查、不可改、不可删 — append-only.
3. **智慧问答设定** — care.categories editable tag list + care.ai_draft_enabled toggle. WIRE THE CONSUMERS: the chat classifier reads categories from org_settings (hardcoded fallback if key missing/unreachable); the reply pipeline checks ai_draft_enabled — false ⇒ skip AI drafting, conversations go straight to the human queue. If the classifier is an edge function or external prompt you cannot reach, STOP and report instead of guessing.
4. **渡人阶段** — read-only stage/milestone/source vocab display (from code vocab, showing 键值 column) + editable outreach.event_window_days number.
5. **公开页面** — toggles for /f and /m + inbox_form_notice text (shows at top of /m when set). /f and /m check their flag server-side, FAIL-OPEN when key missing; closed state renders a gentle 「本服务暂停中，请稍后再来 🙏」 page, never an error.

## 4. Stage-vocab unification (CODE ONLY — architect migrates data after)
Canonical stage KEYS aligned with milestone keys in src/lib/outreach.ts. All stage READS render labels via vocab with raw-value fallback (legacy '初次接触' rows must still display correctly); all stage WRITES use keys (incl. care-panel 修行阶段 dropdown + persons create default). DO NOT touch DB data or defaults — architect runs migration 033 after your report. REPORT the final key set explicitly.

## 5. 主页 polish (E2 queue)
- Tiles: +待审报名 (events≥edit, pending registrations count) and +低库存品项 (inventory≥edit, existing threshold) — role-qualified first-4 rule unchanged.
- 我的事项: +care conversations I've taken over (existing assigned logic, unread first) and +inventory requests awaiting approval (inventory≥edit, status pending) — both deep-linked with module chips.
- break_glass_view dedupe: before writing that audit row, check for the same actor+mailbox break_glass_view within the last 30 minutes — skip if found. Thread-action audits unchanged.

## 6. Explicit decisions (don't re-decide)
1. pptxgenjs is the only new dependency; dynamic-import it. 2. No chart libraries — inline SVG per §1. 3. Charts colored by §1 palette EXACTLY; rose only for status. 4. 出席/check-in doesn't exist — never fabricate it. 5. Per-centre displays name-sorted, no ranking, no deltas. 6. All new strings via t(). 7. No DB changes — 032 already applied; 033 is architect's. 8. PostgREST lessons stand: no dotted embedded-column filters without !inner; never discard error objects; every fail-closed branch logs.

## 7. Out of scope
权限矩阵 editing · duty UI · attendance tracking · WhatsApp/email send · E2b Gmail ingest · E4 translations (dictionary structure only) · contact merge.

## 8. Definition of done
Typecheck + build clean → commit (code + docs/erp/22-e3-brief.md + mockup if present per STEP 2 + migrations/032_reports_and_settings.sql) → push to main → Vercel deploy green → report: routes added, files touched, the FINAL STAGE KEY SET, how you wired the classifier/ai_draft consumers, pptxgenjs bundle impact, any contract deviations + why, anything needing architect DB follow-up. Do NOT run the browser test script below — separate round.

---

# Browser test round (later — Chrome agent + Ken)
Setup by architect first (reactivate 测试分会长+测试ERP, enable 蒲种). 1. /dashboard/reports as admin: month chips, all 5 pages render with charts (no label collisions), month numbers match architect's precomputed SQL. 2. 演示模式: fullscreen, ←→ pages, dots, ESC. 3. 导出 PPT: downloads, opens, charts editable, palette correct. 4. 打印 preview: page-per-dept. 5. CSV downloads. 6. centre_head: own-slice only, 关怀/财务 pages absent, others' rows absent. 7. erp_admin: national view-only; committee-equivalent check. 8. 设置 as erp_admin: sees new sections, NOT 义工与账号; as admin sees all. 9. 权限矩阵 matches live grants. 10. 审计查看器: filter module=inbox finds E2's break_glass_view rows; expand before/after. 11. 智慧问答设定: add category 测试分类 → visible in classifier behavior/report page; remove. AI 草稿 off → send test chat msg → lands needs_human with no draft → toggle back ON (≤5 min window). 12. 渡人阶段: window 90→30 → funnel/活动效果 recompute → back to 90. 13. 公开页面: /m off → gentle closed page → on; notice text shows on /m. 14. 主页: new tiles + new 我的事项 rows per role. 15. Stage: 渡人卡/care panel stage labels still Chinese (fallback pre-033). Report all; leave test data; architect audits + cleans + runs 033.

---

# Appendix — migrations/032_reports_and_settings.sql (already applied; commit verbatim)

```sql
-- 032_reports_and_settings (E3, additive only — zero impact before E3 code ships)
-- 1. 报表中心 module grants (matrix per approved phase-e mockup)
insert into public.role_grants (role, module, access) values
  ('admin','reports','admin'),
  ('erp_admin','reports','view'),
  ('committee','reports','view'),
  ('finance_director','reports','view'),
  ('centre_head','reports','view')
on conflict do nothing;

-- 2. org_settings seeds for the new 设置 sections (public routes fail-open if key missing)
insert into public.org_settings (key, value) values
  ('care.categories',
   '["修行方法","解梦","玄学问答","健康","因果业障","事业财运","家庭","感情婚姻","人际关系","学业","其他","闲聊测试"]'::jsonb),
  ('care.ai_draft_enabled', 'true'::jsonb),
  ('outreach.event_window_days', '90'::jsonb),
  ('public.fee_check_enabled', 'true'::jsonb),
  ('public.inbox_form_enabled', 'true'::jsonb)
on conflict (key) do nothing;
```
