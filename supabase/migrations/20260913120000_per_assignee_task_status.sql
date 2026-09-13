-- السماح للموظف بتغيير حالة مشاركته في المهمة فقط (حالة كل موظف مستقلة)
create or replace function public.set_assignee_status(p_task_id uuid, p_status text)
returns void
language plpgsql security definer set search_path = ''
as $fn$
declare
  v_emp_id uuid;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if p_status not in ('todo','in_progress','done') then
    raise exception 'Invalid status.' using errcode = '22023';
  end if;
  select id into v_emp_id
    from public.employees
   where user_id = v_uid and archived_at is null;
  if v_emp_id is null then
    raise exception 'Account is not linked to an active employee.' using errcode = '42501';
  end if;
  if not exists(select 1 from public.task_assignees where task_id = p_task_id and employee_id = v_emp_id) then
    raise exception 'You are not assigned to this task.' using errcode = '42501';
  end if;
  update public.task_assignees
     set status = p_status,
         completed_by = case when p_status = 'done' then v_emp_id else null end,
         completed_at = case when p_status = 'done' then now() else null end
   where task_id = p_task_id and employee_id = v_emp_id;
end $fn$;

grant execute on function public.set_assignee_status(uuid, text) to authenticated;

-- تجميع الحالة الإجمالية للمهمة من حالات المشاركين (لإبقاء عرض المشرف/المنشئ محدثًا)
create or replace function public.sync_task_status_from_assignees()
returns trigger
language plpgsql security definer set search_path = ''
as $fn$
declare
  v_task uuid;
  v_status text;
  v_completed_by uuid;
  v_completed_at timestamptz;
begin
  v_task := coalesce(new.task_id, old.task_id);
  if v_task is null then
    return coalesce(new, old);
  end if;
  select
    case
      when bool_and(status = 'done') then 'done'
      when bool_or(status <> 'todo') then 'in_progress'
      else 'todo'
    end,
    case when bool_and(status = 'done') then
      (select ta2.employee_id
         from public.task_assignees ta2
        where ta2.task_id = v_task and ta2.status = 'done'
        order by ta2.completed_at desc nulls last limit 1)
    else null end,
    case when bool_and(status = 'done') then
      (select max(ta2.completed_at)
         from public.task_assignees ta2
        where ta2.task_id = v_task and ta2.status = 'done')
    else null end
  into v_status, v_completed_by, v_completed_at
    from public.task_assignees
   where task_id = v_task;

  if v_status is null then
    v_status := 'todo';
  end if;
  update public.tasks
     set status = v_status,
         completed_by = v_completed_by,
         completed_at = v_completed_at
   where id = v_task;
  return coalesce(new, old);
end $fn$;

drop trigger if exists task_assignees_sync_status on public.task_assignees;
create trigger task_assignees_sync_status
after insert or update of status, completed_by, completed_at or delete
on public.task_assignees
for each row execute function public.sync_task_status_from_assignees();