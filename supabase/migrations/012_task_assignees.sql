begin;

-- جدول ربط المهمة بالموظفين العاملين عليها
create table public.task_assignees (
  task_id uuid not null references public.tasks(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, employee_id)
);
create index task_assignees_employee_idx on public.task_assignees(employee_id);

-- دالة مساعدة لكسر تكرار RLS بين tasks و task_assignees (تمرير عبر security definer)
create or replace function public.is_task_assignee(p_task_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.task_assignees ta
    join public.employees e on e.id = ta.employee_id
    where ta.task_id = is_task_assignee.p_task_id
      and e.user_id = auth.uid()
  );
$$;
revoke execute on function public.is_task_assignee(uuid) from public;
grant execute on function public.is_task_assignee(uuid) to authenticated;

-- ملء المهام الموجودة من العمود القديم employee_id
insert into public.task_assignees(task_id, employee_id)
select id, employee_id from public.tasks
where employee_id is not null
on conflict do nothing;

alter table public.task_assignees enable row level security;
revoke all on public.task_assignees from anon;
grant select, insert, delete on public.task_assignees to authenticated;
grant all on public.task_assignees to service_role;

create policy task_assignees_select on public.task_assignees for select to authenticated
using (
  public.current_app_role() in ('owner','management','supervisor')
  or public.is_task_assignee(task_id)
);

create policy task_assignees_insert on public.task_assignees for insert to authenticated
with check (
  public.current_app_role() in ('owner','management','supervisor')
  or task_id in (select id from public.tasks where assigned_by = auth.uid())
);

create policy task_assignees_delete on public.task_assignees for delete to authenticated
using (
  public.current_app_role() in ('owner','management','supervisor')
  or task_id in (select id from public.tasks where assigned_by = auth.uid())
);

-- توسيع صلاحية قراءة المهام لتشمل المُسنَدين المتعددين
drop policy if exists tasks_read on public.tasks;
create policy tasks_read on public.tasks for select to authenticated
using (
  public.current_app_role() in ('owner','management','supervisor')
  or employee_id in (select id from public.employees where user_id = auth.uid())
  or public.is_task_assignee(id)
  or id in (
    select task_id from public.review_requests
    where reviewer_id in (select id from public.employees where user_id = auth.uid())
  )
);

-- توسيع صلاحية تحديث المهام لتشمل المُسنَدين المتعددين
drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks for update to authenticated
using (
  public.current_app_role() in ('owner','management','supervisor')
  or exists(select 1 from public.employees where user_id = auth.uid() and archived_at is null
            and id in (select employee_id from public.task_assignees where task_id = tasks.id))
  or (employee_id in (select id from public.employees where user_id = auth.uid())
      and exists(select 1 from public.employees where user_id = auth.uid() and archived_at is null))
)
with check (
  public.current_app_role() in ('owner','management','supervisor')
  or exists(select 1 from public.employees where user_id = auth.uid() and archived_at is null
            and id in (select employee_id from public.task_assignees where task_id = tasks.id))
  or (employee_id in (select id from public.employees where user_id = auth.uid())
      and exists(select 1 from public.employees where user_id = auth.uid() and archived_at is null))
);

-- السماح للموظف بحذف المهام التي أضافها هو، مع إبقاء صلاحية الإدارة
create or replace function public.delete_task(target_id uuid)
returns uuid language plpgsql security definer set search_path = ''
as $function$
declare caller_role text;
begin
  caller_role = public.current_app_role();
  if (caller_role is null or caller_role not in ('owner','supervisor')) then
    if caller_role <> 'employee'
       or not exists(select 1 from public.tasks t where t.id = target_id and t.assigned_by = auth.uid()) then
      raise exception 'Administrator required' using errcode = '42501';
    end if;
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
end $function$;
revoke execute on function public.delete_task(uuid) from public;
grant execute on function public.delete_task(uuid) to authenticated, service_role;

-- إتاحة task_assignees عبر Realtime للدسكتوب
alter publication supabase_realtime add table public.task_assignees;

commit;