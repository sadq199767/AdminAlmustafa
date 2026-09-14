begin;

alter table public.employees
  add column if not exists last_seen_at timestamptz;

comment on column public.employees.last_seen_at is
  'Last verified heartbeat received from the employee desktop application.';

commit;
