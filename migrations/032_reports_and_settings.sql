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
