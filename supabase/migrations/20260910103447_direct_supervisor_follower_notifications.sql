begin;

-- Follower capability is additive and does not replace the base account role.
alter table public.profiles
  add column if not exists can_follow_tasks boolean not null default false;

update public.profiles
set can_follow_tasks = true,
    role = 'employee'
where role = 'follower';

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('owner','management','supervisor','employee'));

-- The employee who receives attendance notifications for this employee.
alter table public.employees
  add column if not exists supervisor_id uuid null
  references public.employees(id) on delete set null;
alter table public.employees
  add column if not exists task_color text null;
alter table public.employees drop constraint if exists employees_supervisor_not_self;
alter table public.employees
  add constraint employees_supervisor_not_self
  check (supervisor_id is null or supervisor_id <> id);
alter table public.employees drop constraint if exists employees_task_color_check;
alter table public.employees
  add constraint employees_task_color_check
  check (task_color is null or task_color ~ '^#[0-9A-Fa-f]{6}$');
create index if not exists employees_supervisor_id_idx
  on public.employees(supervisor_id) where supervisor_id is not null;

create or replace function public.validate_direct_supervisor() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.supervisor_id is not null and not exists (
    select 1
    from public.employees supervisor
    join public.profiles profile on profile.id = supervisor.user_id
    where supervisor.id = new.supervisor_id
      and supervisor.archived_at is null
      and profile.role in ('owner','supervisor')
  ) then
    raise exception 'Select an active owner or direct supervisor.' using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists validate_direct_supervisor on public.employees;
create trigger validate_direct_supervisor
before insert or update of supervisor_id on public.employees
for each row execute function public.validate_direct_supervisor();

create table if not exists public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  author_name text not null check (char_length(author_name) between 2 and 100),
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists task_comments_task_created_idx
  on public.task_comments(task_id, created_at);
alter table public.task_comments enable row level security;
revoke all on public.task_comments from anon, authenticated;
grant select, insert on public.task_comments to authenticated;
grant all on public.task_comments to service_role;

drop policy if exists task_comments_read on public.task_comments;
create policy task_comments_read on public.task_comments for select to authenticated
using (task_id in (select id from public.tasks));
drop policy if exists task_comments_insert on public.task_comments;
create policy task_comments_insert on public.task_comments for insert to authenticated
with check (
  author_id = (select auth.uid())
  and author_name = (select name from public.profiles where id = (select auth.uid()))
  and task_id in (select id from public.tasks)
  and not exists (select 1 from public.app_settings where system_suspended)
);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'task_comments'
  ) then
    alter publication supabase_realtime add table public.task_comments;
  end if;
end $$;

-- Followers can also read tasks they created in the sent-tasks section.
drop policy if exists tasks_read on public.tasks;
create policy tasks_read on public.tasks for select to authenticated
using (
  (select public.current_app_role()) in ('owner','management','supervisor')
  or assigned_by = (select auth.uid())
  or employee_id in (
    select id from public.employees
    where user_id = (select auth.uid()) and archived_at is null
  )
  or public.is_task_assignee(id)
  or id in (
    select task_id from public.review_requests
    where reviewer_id in (
      select id from public.employees where user_id = (select auth.uid())
    )
  )
);

drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks for update to authenticated
using (
  (select public.current_app_role()) in ('owner','management','supervisor')
  or assigned_by = (select auth.uid())
  or exists (
    select 1 from public.employees
    where user_id = (select auth.uid()) and archived_at is null
      and id in (select employee_id from public.task_assignees where task_id = tasks.id)
  )
)
with check (
  (select public.current_app_role()) in ('owner','management','supervisor')
  or assigned_by = (select auth.uid())
  or exists (
    select 1 from public.employees
    where user_id = (select auth.uid()) and archived_at is null
      and id in (select employee_id from public.task_assignees where task_id = tasks.id)
  )
);

drop policy if exists task_assignees_select on public.task_assignees;
create policy task_assignees_select on public.task_assignees for select to authenticated
using (
  (select public.current_app_role()) in ('owner','management','supervisor')
  or public.is_task_assignee(task_id)
  or exists (
    select 1 from public.tasks t
    where t.id = task_id and t.assigned_by = (select auth.uid())
  )
);

create or replace function public.track_task_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and exists(select 1 from public.app_settings where system_suspended) then
    raise exception 'The system is paused by the owner.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and public.current_app_role() = 'employee' then
    if old.assigned_by = auth.uid() then
      if (to_jsonb(new) - array['title','description','employee_id','priority','due_date','status','updated_at','completed_at'])
         is distinct from (to_jsonb(old) - array['title','description','employee_id','priority','due_date','status','updated_at','completed_at']) then
        raise exception 'The task creator cannot be changed.' using errcode = '42501';
      end if;
    elsif (to_jsonb(new) - array['status','updated_at','completed_at'])
          is distinct from (to_jsonb(old) - array['status','updated_at','completed_at']) then
      raise exception 'You can edit only tasks you created.' using errcode = '42501';
    end if;
  end if;
  if not exists(select 1 from public.employees where id = new.employee_id and archived_at is null) then
    raise exception 'The employee is archived.' using errcode = '22023';
  end if;
  if tg_op = 'INSERT' then
    new.assigned_by = auth.uid(); new.status = 'todo'; new.completed_at = null;
  elsif new.status is distinct from old.status then
    new.completed_at = case when new.status = 'done' then now() else null end;
  else
    new.completed_at = old.completed_at;
  end if;
  new.updated_at = now();
  return new;
end $$;

create or replace function private.save_employee_task(
  p_id uuid, p_create boolean, p_title text, p_description text,
  p_priority text, p_due_date date, p_assignee_ids uuid[]
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  emp_id uuid;
  actor_role text;
  can_follow boolean := false;
  members uuid[];
  requested uuid[];
  row_task public.tasks;
begin
  select role, can_follow_tasks into actor_role, can_follow
  from public.profiles where id = actor;
  if actor is null or actor_role is null then
    raise exception 'Sign in with an active account.' using errcode = '42501';
  end if;
  if exists(select 1 from public.app_settings where system_suspended) then
    raise exception 'The system is paused by the owner.' using errcode = '42501';
  end if;
  select id into emp_id from public.employees
  where user_id = actor and archived_at is null;
  if emp_id is null then
    raise exception 'Your account is not linked to an active employee.' using errcode = '42501';
  end if;
  if p_id is null or p_create is null then
    raise exception 'Invalid request.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  select * into row_task from public.tasks where id = p_id for update;
  if found then
    if row_task.assigned_by is distinct from actor then
      raise exception 'You can edit only tasks you created.' using errcode = '42501';
    end if;
    if p_create then
      return to_jsonb(row_task) || jsonb_build_object(
        'assignee_ids',
        (select coalesce(jsonb_agg(employee_id), '[]'::jsonb)
         from public.task_assignees where task_id = p_id)
      );
    end if;
  elsif not p_create then
    raise exception 'The task does not exist.' using errcode = 'P0002';
  end if;

  if p_title is null or length(btrim(p_title)) not between 3 and 200
     or p_description is null or length(p_description) > 5000
     or p_priority is null or p_priority not in ('low','medium','high') then
    raise exception 'Check the task title and description.' using errcode = '22023';
  end if;

  requested := coalesce(p_assignee_ids, '{}'::uuid[]);
  if not can_follow and actor_role not in ('owner','supervisor') then
    requested := array_prepend(emp_id, requested);
  end if;
  select array_agg(member order by first_position) into members
  from (
    select member, min(position) as first_position
    from unnest(requested) with ordinality as chosen(member, position)
    where member is not null
    group by member
  ) unique_members;

  if coalesce(cardinality(members), 0) < 1
     or cardinality(members) > 8
     or (select count(*) from public.employees
         where id = any(members) and archived_at is null) <> cardinality(members) then
    raise exception 'Select between one and eight active employees.' using errcode = '22023';
  end if;

  if p_create then
    insert into public.tasks(id,title,description,priority,due_date,employee_id,assigned_by)
    values(p_id,btrim(p_title),p_description,p_priority,p_due_date,members[1],actor)
    returning * into row_task;
  else
    update public.tasks
    set title=btrim(p_title), description=p_description, priority=p_priority,
        due_date=p_due_date, employee_id=members[1]
    where id=p_id returning * into row_task;
  end if;

  delete from public.task_assignees
  where task_id = p_id and not(employee_id = any(members));
  insert into public.task_assignees(task_id,employee_id)
  select p_id,unnest(members) on conflict do nothing;
  return to_jsonb(row_task) || jsonb_build_object('assignee_ids', to_jsonb(members));
end $$;

revoke all on function private.save_employee_task(uuid,boolean,text,text,text,date,uuid[])
  from public,anon,service_role;
grant execute on function private.save_employee_task(uuid,boolean,text,text,text,date,uuid[])
  to authenticated;

drop function if exists public.task_directory();
drop function if exists private.task_directory();
create function private.task_directory()
returns table(id uuid,name text,profession text,task_color text,user_id uuid)
language sql stable security definer set search_path = '' as $$
  select e.id,e.name,e.profession,e.task_color,e.user_id
  from public.employees e
  where auth.uid() is not null
    and public.current_app_role() is not null
    and e.archived_at is null
  order by e.name;
$$;
revoke all on function private.task_directory() from public,anon,service_role;
grant execute on function private.task_directory() to authenticated;
create function public.task_directory()
returns table(id uuid,name text,profession text,task_color text,user_id uuid)
language sql stable security invoker set search_path = '' as $$
  select * from private.task_directory();
$$;
revoke all on function public.task_directory() from public,anon,service_role;
grant execute on function public.task_directory() to authenticated;

create or replace function public.set_task_color(p_color text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or public.current_app_role() is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if p_color is not null and p_color !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'Invalid color.' using errcode = '22023';
  end if;
  update public.employees set task_color = p_color
  where user_id = auth.uid() and archived_at is null;
  if not found then
    raise exception 'Your account is not linked to an active employee.' using errcode = '42501';
  end if;
end $$;
revoke all on function public.set_task_color(text) from public,anon,service_role;
grant execute on function public.set_task_color(text) to authenticated;

drop policy if exists profiles_owner_update on public.profiles;
create policy profiles_owner_update on public.profiles for update to authenticated
using ((select public.current_app_role()) = 'owner' and id <> (select auth.uid()))
with check (role in ('management','supervisor','employee'));

create or replace function public.delete_task(target_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare caller_role text := public.current_app_role(); author uuid;
begin
  if auth.uid() is null or caller_role is null then
    raise exception 'Sign in with an active account.' using errcode='42501';
  end if;
  if exists(select 1 from public.app_settings where system_suspended) then
    raise exception 'The system is paused by the owner.' using errcode='42501';
  end if;
  select assigned_by into author from public.tasks where id=target_id for update;
  if not found then
    raise exception 'The task does not exist.' using errcode='P0002';
  end if;
  if caller_role not in ('owner','supervisor') and author is distinct from auth.uid() then
    raise exception 'You can delete only tasks you created.' using errcode='42501';
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
