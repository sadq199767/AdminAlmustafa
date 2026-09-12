begin;

-- Privileged operations are private; public RPC wrappers retain caller identity.
create schema if not exists private;
grant usage on schema private to authenticated;

create or replace function public.track_task_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and public.current_app_role() = 'employee' then
    if old.assigned_by = auth.uid() then
      if (to_jsonb(new) - array['title','description','priority','due_date','status','updated_at','completed_at'])
         is distinct from (to_jsonb(old) - array['title','description','priority','due_date','status','updated_at','completed_at']) then
        raise exception 'لا يمكنك تغيير صاحب المهمة.' using errcode = '42501';
      end if;
    elsif (to_jsonb(new) - array['status','updated_at','completed_at'])
          is distinct from (to_jsonb(old) - array['status','updated_at','completed_at']) then
      raise exception 'يمكنك تعديل المهام التي أضفتها أنت فقط.' using errcode = '42501';
    end if;
  end if;
  if not exists(select 1 from public.employees where id = new.employee_id and archived_at is null) then
    raise exception 'الموظف مؤرشف.' using errcode = '22023';
  end if;
  if tg_op = 'INSERT' then
    new.assigned_by = auth.uid(); new.status = 'todo'; new.completed_at = null;
  elsif new.status is distinct from old.status then
    new.completed_at = case when new.status = 'done' then now() else null end;
  else new.completed_at = old.completed_at;
  end if;
  new.updated_at = now(); return new;
end $$;

create or replace function private.save_employee_task(
  p_id uuid, p_create boolean, p_title text, p_description text,
  p_priority text, p_due_date date, p_assignee_ids uuid[]
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid(); emp_id uuid; members uuid[]; row_task public.tasks;
begin
  if actor is null or public.current_app_role() is null then
    raise exception 'يرجى تسجيل الدخول بحساب فعال.' using errcode = '42501';
  end if;
  if exists(select 1 from public.app_settings where system_suspended) then
    raise exception 'النظام موقوف مؤقتًا من قبل المالك.' using errcode = '42501';
  end if;
  select id into emp_id from public.employees where user_id = actor and archived_at is null;
  if emp_id is null then raise exception 'حسابك غير مرتبط بموظف فعال.' using errcode = '42501'; end if;
  if p_id is null or p_create is null then raise exception 'طلب غير صالح.' using errcode = '22023'; end if;
  -- The stable client ID makes retrying an interrupted create safe.
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  select * into row_task from public.tasks where id = p_id for update;
  if found then
    if row_task.assigned_by is distinct from actor or row_task.employee_id <> emp_id then
      raise exception 'يمكنك تعديل المهام التي أضفتها أنت فقط.' using errcode = '42501';
    end if;
    if p_create then
      return to_jsonb(row_task) || jsonb_build_object('assignee_ids',
        (select coalesce(jsonb_agg(employee_id), '[]'::jsonb) from public.task_assignees where task_id = p_id));
    end if;
  elsif not p_create then
    raise exception 'المهمة غير موجودة أو حُذفت.' using errcode = 'P0002';
  end if;
  if p_title is null or length(btrim(p_title)) not between 3 and 200
     or p_description is null or length(p_description) > 5000
     or p_priority is null or p_priority not in ('low','medium','high') then
    raise exception 'تحقق من عنوان المهمة وتفاصيلها.' using errcode = '22023';
  end if;
  select array_agg(distinct member) into members from unnest(array_append(coalesce(p_assignee_ids, '{}'::uuid[]), emp_id)) member;
  if cardinality(members) > 8 or array_position(members, null) is not null
     or (select count(*) from public.employees where id = any(members) and archived_at is null) <> cardinality(members) then
    raise exception 'اختر حتى ٨ موظفين فعالين للمهمة.' using errcode = '22023';
  end if;
  if p_create then
    insert into public.tasks(id,title,description,priority,due_date,employee_id,assigned_by)
      values(p_id,btrim(p_title),p_description,p_priority,p_due_date,emp_id,actor) returning * into row_task;
  else
    update public.tasks set title=btrim(p_title), description=p_description, priority=p_priority, due_date=p_due_date
      where id=p_id returning * into row_task;
  end if;
  delete from public.task_assignees where task_id = p_id and not(employee_id = any(members));
  insert into public.task_assignees(task_id,employee_id) select p_id,unnest(members) on conflict do nothing;
  return to_jsonb(row_task) || jsonb_build_object('assignee_ids', to_jsonb(members));
end $$;
revoke all on function private.save_employee_task(uuid,boolean,text,text,text,date,uuid[]) from public,anon,service_role;
grant execute on function private.save_employee_task(uuid,boolean,text,text,text,date,uuid[]) to authenticated;

create or replace function public.save_employee_task(
  p_id uuid, p_create boolean, p_title text, p_description text,
  p_priority text, p_due_date date, p_assignee_ids uuid[]
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.save_employee_task(p_id,p_create,p_title,p_description,p_priority,p_due_date,p_assignee_ids);
$$;
revoke all on function public.save_employee_task(uuid,boolean,text,text,text,date,uuid[]) from public,anon,service_role;
grant execute on function public.save_employee_task(uuid,boolean,text,text,text,date,uuid[]) to authenticated;

create or replace function private.task_directory() returns table(id uuid,name text,profession text)
language sql stable security definer set search_path = '' as $$
  select e.id,e.name,e.profession from public.employees e
  where auth.uid() is not null and public.current_app_role() is not null and e.archived_at is null order by e.name;
$$;
revoke all on function private.task_directory() from public,anon,service_role;
grant execute on function private.task_directory() to authenticated;
create or replace function public.task_directory() returns table(id uuid,name text,profession text)
language sql stable security invoker set search_path = '' as $$ select * from private.task_directory(); $$;
revoke all on function public.task_directory() from public,anon,service_role;
grant execute on function public.task_directory() to authenticated;

-- Assignment edits must go through the atomic, ownership-checked operation.
revoke insert,update,delete on public.task_assignees from authenticated;
create or replace function public.is_task_assignee(p_task_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists(select 1 from public.task_assignees ta
    join public.employees e on e.id=ta.employee_id
    where ta.task_id=p_task_id and e.user_id=auth.uid() and e.archived_at is null);
$$;
drop policy if exists task_assignees_select on public.task_assignees;
create policy task_assignees_select on public.task_assignees for select to authenticated
using ((select public.current_app_role()) in ('owner','management','supervisor')
  or public.is_task_assignee(task_id)
  or exists(select 1 from public.tasks t where t.id=task_id and t.employee_id in
    (select id from public.employees where user_id=(select auth.uid()) and archived_at is null)));

create or replace function public.delete_task(target_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare caller_role text := public.current_app_role(); author uuid;
begin
  if auth.uid() is null or caller_role is null then
    raise exception 'يرجى تسجيل الدخول بحساب فعال.' using errcode='42501';
  end if;
  if exists(select 1 from public.app_settings where system_suspended) then
    raise exception 'النظام موقوف مؤقتًا من قبل المالك.' using errcode='42501';
  end if;
  select assigned_by into author from public.tasks where id=target_id for update;
  if not found then raise exception 'المهمة غير موجودة أو حُذفت.' using errcode='P0002'; end if;
  if caller_role not in ('owner','supervisor') and (caller_role <> 'employee' or author is distinct from auth.uid()) then
    raise exception 'يمكنك حذف المهام التي أضفتها أنت فقط.' using errcode='42501';
  end if;
  delete from public.notification_deliveries
    where event_id in (select id from public.task_activities where task_id=target_id)
       or event_id in (select id from public.review_requests where task_id=target_id);
  delete from public.tasks where id=target_id;
  return target_id;
end $$;
revoke all on function public.delete_task(uuid) from public,anon;
grant execute on function public.delete_task(uuid) to authenticated,service_role;
notify pgrst,'reload schema';
commit;
