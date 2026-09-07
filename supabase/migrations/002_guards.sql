begin;
grant execute on function public.current_app_role() to service_role;
create or replace function public.guard_employee_update() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if public.current_app_role()='manager' and (to_jsonb(new)-'archived_at') is distinct from (to_jsonb(old)-'archived_at') then raise exception 'Only owner can edit employee details'; end if;
  if new.archived_at is not null and old.archived_at is null then
    if old.user_id=auth.uid() or exists(select 1 from public.profiles where id=old.user_id and role='owner') then raise exception 'Owner and current account cannot be archived'; end if;
    if exists(select 1 from public.tasks where employee_id=old.id and status<>'done') then raise exception 'Complete open tasks before archiving'; end if;
  end if;
  return new;
end $$;
-- A daily session must be split at local midnight by the desktop client.
alter table public.attendance add constraint attendance_ends_in_day check(ended_at is null or ended_at <= ((work_date+1)::timestamp at time zone 'Asia/Baghdad'));
commit;
