begin;
alter table public.tasks drop constraint tasks_employee_id_fkey;
alter table public.tasks add constraint tasks_employee_id_fkey foreign key(employee_id) references public.employees(id) on delete cascade;
alter table public.attendance drop constraint attendance_employee_id_fkey;
alter table public.attendance add constraint attendance_employee_id_fkey foreign key(employee_id) references public.employees(id) on delete cascade;
alter table public.daily_reports drop constraint daily_reports_employee_id_fkey;
alter table public.daily_reports add constraint daily_reports_employee_id_fkey foreign key(employee_id) references public.employees(id) on delete cascade;
alter table public.task_activities drop constraint task_activities_task_id_fkey;
alter table public.task_activities add constraint task_activities_task_id_fkey foreign key(task_id) references public.tasks(id) on delete cascade;
alter table public.review_requests drop constraint review_requests_task_id_fkey;
alter table public.review_requests add constraint review_requests_task_id_fkey foreign key(task_id) references public.tasks(id) on delete cascade;
alter table public.review_requests drop constraint review_requests_reviewer_id_fkey;
alter table public.review_requests add constraint review_requests_reviewer_id_fkey foreign key(reviewer_id) references public.employees(id) on delete cascade;
alter table public.notification_deliveries drop constraint notification_deliveries_recipient_id_fkey;
alter table public.notification_deliveries add constraint notification_deliveries_recipient_id_fkey foreign key(recipient_id) references public.employees(id) on delete cascade;
-- Preserve authorship labels on other employees' work after an account is deleted.
alter table public.tasks alter column assigned_by drop not null;
alter table public.tasks drop constraint tasks_assigned_by_fkey;
alter table public.tasks add constraint tasks_assigned_by_fkey foreign key(assigned_by) references public.profiles(id) on delete set null;
alter table public.task_activities alter column actor_id drop not null;
alter table public.task_activities drop constraint task_activities_actor_id_fkey;
alter table public.task_activities add constraint task_activities_actor_id_fkey foreign key(actor_id) references public.profiles(id) on delete set null;
alter table public.review_requests alter column requested_by drop not null;
alter table public.review_requests drop constraint review_requests_requested_by_fkey;
alter table public.review_requests add constraint review_requests_requested_by_fkey foreign key(requested_by) references public.profiles(id) on delete set null;
create function public.delete_employee(target_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare target_user uuid; target_role text; caller_role text;
begin
  caller_role=public.current_app_role();
  if caller_role is null or caller_role not in ('owner','manager') then raise exception 'Administrator required'; end if;
  select user_id into target_user from public.employees where id=target_id for update;
  if not found then raise exception 'Employee not found'; end if;
  select role into target_role from public.profiles where id=target_user;
  if target_user=auth.uid() or target_role='owner' then raise exception 'Owner and current account cannot be deleted'; end if;
  if caller_role='manager' and target_role='manager' then raise exception 'Only owner can delete a manager'; end if;
  delete from public.notification_deliveries where recipient_id=target_id
    or event_id in(select id from public.task_activities where task_id in(select id from public.tasks where employee_id=target_id))
    or event_id in(select id from public.review_requests where reviewer_id=target_id or task_id in(select id from public.tasks where employee_id=target_id));
  delete from public.employees where id=target_id;
  -- Revoke all application access atomically with deletion, even if Auth cleanup later fails.
  if target_user is not null then delete from public.profiles where id=target_user; end if;
  return target_user;
end $$;
revoke all on function public.delete_employee(uuid) from public;
grant execute on function public.delete_employee(uuid) to authenticated;
commit;
