alter table public.app_settings
  add column idle_threshold_minutes integer not null default 10
  check (idle_threshold_minutes between 1 and 60);