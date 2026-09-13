begin;

alter table public.employees
  add column if not exists work_days integer[];

update public.employees
set work_days = coalesce(
  (select work_days from public.app_settings where id = 1),
  array[0, 1, 2, 3, 4]
)
where work_days is null;

alter table public.employees
  alter column work_days set default array[0, 1, 2, 3, 4],
  alter column work_days set not null;

do $migration$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'employees_work_days_check'
      and conrelid = 'public.employees'::regclass
  ) then
    alter table public.employees
      add constraint employees_work_days_check
      check (
        cardinality(work_days) between 1 and 7
        and work_days <@ array[0, 1, 2, 3, 4, 5, 6]
      );
  end if;
end
$migration$;

commit;
