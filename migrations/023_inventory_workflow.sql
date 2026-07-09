-- =====================================================================================
-- 023_inventory_workflow.sql — INVENTORY v2 schema (approval workflow + photos +
-- friendly categories + low-stock lines + reversals)     [APPLIED VIA CONNECTOR]
-- =====================================================================================
-- Supports the agreed v6 design (docs/erp/mockups/inventory-v6.html):
--   • Requests: pending → approved (may approve LESS than requested, reason kept)
--     → released in parts (photo proof per release) → fulfilled; or rejected/cancelled.
--     STOCK MOVES ONLY AT RELEASE (transfer movement linked via request_id).
--   • Movements: optional photo_path (release proof / delivery photo), reversal_of
--     self-link for one-tap 撤销 (reverse entries, ledger stays append-only).
--   • Items: friendly category_cn layer OVER StockID families, photo_path,
--     low_stock_line (feeds dashboard 采购建议; NULL = no alert).
--   • Storage: private bucket `inventory-media` (photos/ + proofs/), service-role
--     mediated, signed URLs — same pattern as payment proofs.
-- =====================================================================================

-- ---------- 1. inventory_items: friendly category + photo + low-stock line ----------

alter table public.inventory_items add column if not exists category_cn text;
alter table public.inventory_items add column if not exists photo_path text;
alter table public.inventory_items add column if not exists low_stock_line integer
  check (low_stock_line is null or low_stock_line >= 0);

-- Seed friendly categories from StockID families (editable in 品项管理 afterwards).
update public.inventory_items set category_cn = case
  when category in ('S001','S002','S003','S004','S005','S006','S007','S008','S009',
                    'S010','S011','S012','L001') then '书籍·善书'
  when category = 'S101' then '小册子'
  when category = 'S201' then '经书·经书套'
  when category in ('S203','S301','S302','S401') then '经文·纸类'
  when category = 'S501' then '宣传单·文宣'
  when category = 'S601' then '光碟·影音'
  when category = 'S901' then '结缘小物'
  else null end
where category_cn is null;

-- Uncoded items: name-based defaults (rest fall to 结缘小物).
update public.inventory_items set category_cn = '法器·念佛机'
  where stock_id is null and name_cn in ('念佛机','计数器');
update public.inventory_items set category_cn = '书籍·善书'
  where stock_id is null and category_cn is null
    and (name_cn like '%漫画%' or name_cn like '%COMIC%' or name_cn like '后记%');
update public.inventory_items set category_cn = '经文·纸类'
  where stock_id is null and category_cn is null and name_cn like 'A4 每日功课%';
update public.inventory_items set category_cn = '结缘小物'
  where stock_id is null and category_cn is null;

-- ---------- 2. inventory_requests: approval lifecycle ----------

alter table public.inventory_requests drop constraint if exists inventory_requests_status_check;
alter table public.inventory_requests add constraint inventory_requests_status_check
  check (status in ('pending','approved','partial','fulfilled','rejected','cancelled'));

alter table public.inventory_requests add column if not exists qty_approved integer
  check (qty_approved is null or qty_approved > 0);
alter table public.inventory_requests add column if not exists approve_reason text;
alter table public.inventory_requests add column if not exists approved_by uuid references public.volunteers(id);
alter table public.inventory_requests add column if not exists approved_at timestamptz;
alter table public.inventory_requests add column if not exists rejected_reason text;

alter table public.inventory_requests drop constraint if exists inventory_requests_fulfil_within_approved;
alter table public.inventory_requests add constraint inventory_requests_fulfil_within_approved
  check (qty_approved is null or qty_fulfilled <= qty_approved);

-- ---------- 3. inventory_movements: photos + reversals + request link ----------

alter table public.inventory_movements add column if not exists photo_path text;
alter table public.inventory_movements add column if not exists request_id uuid
  references public.inventory_requests(id);
alter table public.inventory_movements add column if not exists reversal_of uuid
  references public.inventory_movements(id);

create index if not exists inventory_movements_request_idx
  on public.inventory_movements(request_id) where request_id is not null;
create unique index if not exists inventory_movements_reversal_uniq
  on public.inventory_movements(reversal_of) where reversal_of is not null; -- one reversal max

-- ---------- 4. STORAGE: private media bucket (photos/ + proofs/) ----------

insert into storage.buckets (id, name, public)
values ('inventory-media', 'inventory-media', false)
on conflict (id) do nothing;

-- ---------- VERIFY (read-only; run after apply) ----------
-- select category_cn, count(*) from inventory_items group by 1 order by 2 desc; -- 9 friendly cats, 0 null
-- select conname from pg_constraint where conrelid='public.inventory_requests'::regclass; -- new status check present
-- select column_name from information_schema.columns where table_name='inventory_movements'
--   and column_name in ('photo_path','request_id','reversal_of'); -- 3 rows
-- select id, public from storage.buckets where id='inventory-media'; -- 1 row, public=false
