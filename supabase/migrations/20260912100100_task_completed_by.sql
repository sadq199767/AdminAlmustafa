alter table public.tasks
  add column if not exists completed_by uuid references public.employees(id) on delete set null;

create index if not exists tasks_completed_by_idx on public.tasks (completed_by) where completed_by is not null;