begin;

-- ============================================================
-- 010: المالك (owner) يملك كل شيء، دور الإدارة (management) للمتابعة،
--      وإيقاف النظام بالكامل (system_suspended) عبر app_settings.
-- ============================================================

-- 1) إضافة دور الإدارة إلى قيد الأدوار
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('owner', 'management', 'supervisor', 'employee'));

-- 2) أعمدة إيقاف النظام كلياً (البرنامج + لوحة التحكم)
alter table public.app_settings
  add column if not exists system_suspended boolean not null default false;
alter table public.app_settings
  add column if not exists system_suspend_reason text not null default '';

-- 3) سياسات القراءة: المالك والإدارة والمسؤول المباشر يطّلعون على كل شيء
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.current_app_role() in ('owner', 'management', 'supervisor'));

drop policy if exists employees_read on public.employees;
create policy employees_read on public.employees for select to authenticated
  using (public.current_app_role() in ('owner', 'management', 'supervisor') or user_id = auth.uid());

drop policy if exists tasks_read on public.tasks;
create policy tasks_read on public.tasks for select to authenticated
  using (public.current_app_role() in ('owner', 'management', 'supervisor')
    or employee_id in (select id from public.employees where user_id = auth.uid())
    or id in (select task_id from public.review_requests where reviewer_id in (select id from public.employees where user_id = auth.uid())));

drop policy if exists attendance_read on public.attendance;
create policy attendance_read on public.attendance for select to authenticated
  using (public.current_app_role() in ('owner', 'management', 'supervisor') or employee_id in (select id from public.employees where user_id = auth.uid()));

drop policy if exists reports_read on public.daily_reports;
create policy reports_read on public.daily_reports for select to authenticated
  using (public.current_app_role() in ('owner', 'management', 'supervisor') or employee_id in (select id from public.employees where user_id = auth.uid()));

drop policy if exists activities_read on public.task_activities;
create policy activities_read on public.task_activities for select to authenticated
  using (public.current_app_role() in ('owner', 'management', 'supervisor') or task_id in (select id from public.tasks));

drop policy if exists reviews_read on public.review_requests;
create policy reviews_read on public.review_requests for select to authenticated
  using (public.current_app_role() in ('owner', 'management', 'supervisor')
    or requested_by = auth.uid()
    or reviewer_id in (select id from public.employees where user_id = auth.uid()));

drop policy if exists settings_read on public.app_settings;
create policy settings_read on public.app_settings for select to authenticated
  using (public.current_app_role() in ('owner', 'management', 'supervisor'));

-- 4) الكتابة: المالك يملك كل شيء مثل المسؤول المباشر
drop policy if exists employees_insert on public.employees;
create policy employees_insert on public.employees for insert to authenticated
  with check (public.current_app_role() in ('owner', 'supervisor') and user_id is null);

drop policy if exists employees_update on public.employees;
create policy employees_update on public.employees for update to authenticated
  using (public.current_app_role() in ('owner', 'supervisor'))
  with check (public.current_app_role() in ('owner', 'supervisor'));

drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks for insert to authenticated
  with check (public.current_app_role() in ('owner', 'supervisor') and assigned_by = auth.uid());

drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks for update to authenticated
  using (public.current_app_role() in ('owner', 'supervisor')
    or employee_id in (select id from public.employees where user_id = auth.uid() and archived_at is null))
  with check (public.current_app_role() in ('owner', 'supervisor')
    or employee_id in (select id from public.employees where user_id = auth.uid() and archived_at is null));

-- 5) إدارة الحسابات: المالك والمسؤول المباشر (الإدارة لا تدير الحسابات)
drop policy if exists profiles_owner_update on public.profiles;
create policy profiles_owner_update on public.profiles for update to authenticated
  using (public.current_app_role() in ('owner', 'supervisor') and id <> auth.uid())
  with check (role in ('management', 'supervisor', 'employee'));

-- 6) إعدادات النظام: التعديل للمالك فقط
drop policy if exists settings_owner on public.app_settings;
create policy settings_owner on public.app_settings for update to authenticated
  using (public.current_app_role() = 'owner')
  with check (public.current_app_role() = 'owner');

-- 7) حذف المهام: المالك والمسؤول المباشر
create or replace function public.delete_task(target_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare caller_role text;
begin
  caller_role = public.current_app_role();
  if caller_role is null or caller_role not in ('owner', 'supervisor') then
    raise exception 'Administrator required' using errcode = '42501';
  end if;

  perform 1 from public.tasks where id = target_id for update;
  if not found then
    raise exception 'Task not found' using errcode = 'P0002';
  end if;

  delete from public.notification_deliveries
  where event_id in (select id from public.task_activities where task_id = target_id)
     or event_id in (select id from public.review_requests where task_id = target_id);

  delete from public.tasks where id = target_id;
  return target_id;
end $$;

revoke all on function public.delete_task(uuid) from public;
grant execute on function public.delete_task(uuid) to authenticated;

-- 8) حذف موظف: المالك يمكنه حذف موظفين ومشرفين، والمسؤول المباشر يحذف الموظفين فقط.
--    حسابات المالك والحساب الحالي محمية دائمًا.
create or replace function public.delete_employee(target_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare target_user uuid; target_role text; caller_role text;
begin
  caller_role = public.current_app_role();
  if caller_role is null or caller_role not in ('owner', 'supervisor') then
    raise exception 'Administrator required';
  end if;

  select user_id into target_user from public.employees where id = target_id for update;
  if not found then raise exception 'Employee not found'; end if;

  select role into target_role from public.profiles where id = target_user;

  if target_user = auth.uid() or target_role = 'owner' then
    raise exception 'Owner and current account cannot be deleted';
  end if;

  if caller_role = 'supervisor' and target_role = 'supervisor' then
    raise exception 'Only the owner can delete a supervisor';
  end if;

  delete from public.notification_deliveries where recipient_id = target_id
    or event_id in (select id from public.task_activities where task_id in (select id from public.tasks where employee_id = target_id))
    or event_id in (select id from public.review_requests where reviewer_id = target_id or task_id in (select id from public.tasks where employee_id = target_id));
  delete from public.employees where id = target_id;
  if target_user is not null then delete from public.profiles where id = target_user; end if;
  return target_user;
end $$;

revoke all on function public.delete_employee(uuid) from public;
grant execute on function public.delete_employee(uuid) to authenticated;

commit;