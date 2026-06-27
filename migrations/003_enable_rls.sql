-- Phase 2: enable Row Level Security (locks tables to service_role only;
-- volunteer-access policies to be added in Phase 3 dashboard)
alter table contacts enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;
