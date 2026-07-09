-- 024_stocktake_and_share — inventory v2 batch B: 盘点模式 sessions + read-only share links
-- [APPLIED VIA CONNECTOR 2026-07-09 — canonical record only, never run]

-- 1. Stock-take sessions (盘点模式): draft → confirmed/cancelled
create table public.inventory_stocktakes (
  id            uuid primary key default gen_random_uuid(),
  location_id   uuid not null references public.inventory_locations(id),
  category_cn   text,                          -- null = whole location
  status        text not null default 'draft' check (status in ('draft','confirmed','cancelled')),
  note          text,
  created_by    uuid references public.volunteers(id),
  created_at    timestamptz not null default now(),
  confirmed_by  uuid references public.volunteers(id),
  confirmed_at  timestamptz
);

create table public.inventory_stocktake_lines (
  id            uuid primary key default gen_random_uuid(),
  stocktake_id  uuid not null references public.inventory_stocktakes(id) on delete cascade,
  item_id       uuid not null references public.inventory_items(id),
  system_qty    integer not null,              -- snapshot when the session/line was created
  counted_qty   integer check (counted_qty is null or counted_qty >= 0),
  unique (stocktake_id, item_id)
);
create index inventory_stocktake_lines_st_idx on public.inventory_stocktake_lines(stocktake_id);

-- Adjustments born from a confirmed session link back for traceability.
alter table public.inventory_movements add column if not exists stocktake_id uuid
  references public.inventory_stocktakes(id);

-- 2. Read-only share links (分享库存表): public token → live HQ stock list
create table public.inventory_share_links (
  id          uuid primary key default gen_random_uuid(),
  token       text not null unique,
  label       text,
  is_active   boolean not null default true,
  created_by  uuid references public.volunteers(id),
  created_at  timestamptz not null default now()
);

-- 3. RLS (house pattern: module read; writes service-role mediated)
alter table public.inventory_stocktakes      enable row level security;
alter table public.inventory_stocktake_lines enable row level security;
alter table public.inventory_share_links     enable row level security;

create policy "inventory module can read stocktakes" on public.inventory_stocktakes
  for select using (has_module_access('inventory','view'));
create policy "inventory module can read stocktake lines" on public.inventory_stocktake_lines
  for select using (has_module_access('inventory','view'));
create policy "inventory module can read share links" on public.inventory_share_links
  for select using (has_module_access('inventory','view'));
