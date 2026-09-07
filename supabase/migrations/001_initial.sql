begin;
create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 100),
  role text not null default 'employee' check (role in ('owner','manager','employee')),
  created_at timestamptz not null default now()
);
create table public.employees (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references public.profiles(id) on delete set null,
  name text not null check (char_length(name) between 2 and 100),
  phone text not null default '', profession text not null,
  telegram_id text not null default '' check (telegram_id ~ '^-?[0-9]*$'),
  daily_hours numeric(4,2) not null default 8 check (daily_hours between 0.5 and 24),
  joined_on date not null default current_date,
  archived_at timestamptz, created_at timestamptz not null default now()
);
create function public.current_app_role() returns text language sql stable security definer set search_path = '' as $$ select role from public.profiles where id = auth.uid() and not exists(select 1 from public.employees where user_id=auth.uid() and archived_at is not null) $$;
revoke all on function public.current_app_role() from public;
grant execute on function public.current_app_role() to authenticated;

create table public.tasks (
  id uuid primary key default gen_random_uuid(), title text not null check (char_length(title) between 3 and 200),
  description text not null default '' check (char_length(description) <= 5000),
  employee_id uuid not null references public.employees(id), assigned_by uuid not null references public.profiles(id),
  status text not null default 'todo' check (status in ('todo','in_progress','done')),
  priority text not null default 'medium' check (priority in ('low','medium','high')),
  due_date date, completed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.attendance (
  id uuid primary key, employee_id uuid not null references public.employees(id), work_date date not null,
  started_at timestamptz not null, ended_at timestamptz,
  attendance_seconds integer not null check (attendance_seconds between 0 and 86400),
  active_seconds integer not null check (active_seconds between 0 and attendance_seconds),
  updated_at timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at),
  check (work_date = (started_at at time zone 'Asia/Baghdad')::date)
);
create table public.daily_reports (
  id uuid primary key default gen_random_uuid(), employee_id uuid not null references public.employees(id),
  report_date date not null, summary text not null check (char_length(summary) between 3 and 10000),
  attendance_seconds integer not null default 0, active_seconds integer not null default 0,
  created_at timestamptz not null default now(), unique(employee_id, report_date)
);
create table public.task_activities (
  id uuid primary key default gen_random_uuid(), task_id uuid not null references public.tasks(id),
  actor_id uuid not null references public.profiles(id), actor_name text not null, action text not null,
  created_at timestamptz not null default now()
);
create table public.review_requests (
  id uuid primary key default gen_random_uuid(), task_id uuid not null references public.tasks(id),
  requested_by uuid not null references public.profiles(id), reviewer_id uuid not null references public.employees(id),
  note text not null default '', created_at timestamptz not null default now()
);
create table public.app_settings (
  id integer primary key default 1 check (id=1), organization_name text not null default 'المصطفى',
  work_days integer[] not null default '{0,1,2,3,4}' check (cardinality(work_days) between 1 and 7 and work_days <@ array[0,1,2,3,4,5,6]),
  telegram_enabled boolean not null default false
);
insert into public.app_settings(id) values(1);
create table public.bot_secrets (id integer primary key check(id=1), encrypted_token text not null, updated_at timestamptz not null default now());
create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(), event_id uuid not null, recipient_id uuid not null references public.employees(id),
  message text not null, status text not null default 'pending' check(status in ('pending','sending','sent','failed','skipped')),
  attempts integer not null default 0, last_error text, created_at timestamptz not null default now(), sent_at timestamptz,
  unique(event_id,recipient_id)
);

create function public.guard_employee_update() returns trigger language plpgsql set search_path = '' as $$
begin
  if public.current_app_role()='manager' and (to_jsonb(new)-'archived_at') is distinct from (to_jsonb(old)-'archived_at') then raise exception 'Only owner can edit employee details'; end if;
  return new;
end $$;
create trigger guard_employee_update before update on public.employees for each row execute function public.guard_employee_update();

create function public.track_task_change() returns trigger language plpgsql security definer set search_path = '' as $$
declare actor text; label text;
begin
  if tg_op='UPDATE' and public.current_app_role()='employee' and (to_jsonb(new)-array['status','updated_at','completed_at']) is distinct from (to_jsonb(old)-array['status','updated_at','completed_at']) then raise exception 'Only status can change'; end if;
  if not exists(select 1 from public.employees where id=new.employee_id and archived_at is null) then raise exception 'Employee is archived'; end if;
  if tg_op='INSERT' then
    new.assigned_by=auth.uid(); new.status='todo'; new.completed_at=null; label='أسند مهمة جديدة';
  elsif new.status is distinct from old.status then
    new.completed_at=case when new.status='done' then now() else null end;
    label=case new.status when 'done' then 'أنجز المهمة' when 'in_progress' then 'بدأ العمل على المهمة' else 'أعاد المهمة إلى المطلوب' end;
  else new.completed_at=old.completed_at; end if;
  new.updated_at=now(); return new;
end $$;
create trigger task_change before insert or update on public.tasks for each row execute function public.track_task_change();
create function public.log_task_change() returns trigger language plpgsql security definer set search_path = '' as $$
declare label text;
begin
  label=case when tg_op='INSERT' then 'أسند مهمة جديدة' when new.status='done' then 'أنجز المهمة' when new.status='in_progress' then 'بدأ العمل على المهمة' else 'حدّث المهمة' end;
  insert into public.task_activities(task_id,actor_id,actor_name,action) select new.id,auth.uid(),name,label from public.profiles where id=auth.uid();
  return new;
end $$;
create trigger log_task_change after insert or update on public.tasks for each row execute function public.log_task_change();

create function public.sync_attendance(payload jsonb) returns void language plpgsql security definer set search_path = '' as $$
declare emp uuid; total integer; record_id uuid=(payload->>'id')::uuid; day date=(payload->>'work_date')::date;
begin
  select id into emp from public.employees where user_id=auth.uid() and archived_at is null;
  if emp is null then raise exception 'Employee account required'; end if;
  perform 1 from public.employees where id=emp for update;
  if exists(select 1 from public.attendance where id=record_id and employee_id<>emp) then raise exception 'Session ownership mismatch'; end if;
  if day > (now() at time zone 'Asia/Baghdad')::date then raise exception 'Future attendance'; end if;
  if (payload->>'started_at')::timestamptz > now() or (payload->>'ended_at')::timestamptz > now() then raise exception 'Future session'; end if;
  select coalesce(sum(attendance_seconds),0) into total from public.attendance where employee_id=emp and work_date=day and id<>record_id;
  if total+(payload->>'attendance_seconds')::integer>86400 then raise exception 'Daily attendance exceeds 24 hours'; end if;
  if (payload->>'attendance_seconds')::integer > extract(epoch from (coalesce((payload->>'ended_at')::timestamptz,now())-(payload->>'started_at')::timestamptz))+5 then raise exception 'Duration exceeds elapsed time'; end if;
  insert into public.attendance(id,employee_id,work_date,started_at,ended_at,attendance_seconds,active_seconds)
  values(record_id,emp,day,(payload->>'started_at')::timestamptz,(payload->>'ended_at')::timestamptz,(payload->>'attendance_seconds')::integer,(payload->>'active_seconds')::integer)
  on conflict(id) do update set ended_at=excluded.ended_at, attendance_seconds=excluded.attendance_seconds,active_seconds=excluded.active_seconds,updated_at=now()
  where attendance.employee_id=emp and attendance.work_date=excluded.work_date and attendance.started_at=excluded.started_at and excluded.attendance_seconds>=attendance.attendance_seconds and excluded.active_seconds>=attendance.active_seconds;
end $$;
create function public.submit_daily_report(day date, report_summary text) returns void language plpgsql security definer set search_path = '' as $$
declare emp uuid;
begin
  select id into emp from public.employees where user_id=auth.uid() and archived_at is null;
  if emp is null or day>(now() at time zone 'Asia/Baghdad')::date then raise exception 'Invalid report'; end if;
  insert into public.daily_reports(employee_id,report_date,summary,attendance_seconds,active_seconds)
  select emp,day,report_summary,coalesce(sum(attendance_seconds),0),coalesce(sum(active_seconds),0) from public.attendance where employee_id=emp and work_date=day
  on conflict(employee_id,report_date) do update set summary=excluded.summary,attendance_seconds=excluded.attendance_seconds,active_seconds=excluded.active_seconds;
end $$;
revoke all on function public.sync_attendance(jsonb),public.submit_daily_report(date,text) from public;
grant execute on function public.sync_attendance(jsonb),public.submit_daily_report(date,text) to authenticated;

alter table public.profiles enable row level security;
alter table public.employees enable row level security;
alter table public.tasks enable row level security;
alter table public.attendance enable row level security;
alter table public.daily_reports enable row level security;
alter table public.task_activities enable row level security;
alter table public.review_requests enable row level security;
alter table public.app_settings enable row level security;
alter table public.bot_secrets enable row level security;
alter table public.notification_deliveries enable row level security;

create policy profiles_read on public.profiles for select to authenticated using(id=auth.uid() or public.current_app_role() in ('owner','manager'));
create policy profiles_owner_update on public.profiles for update to authenticated using(public.current_app_role()='owner' and id<>auth.uid()) with check(role in ('manager','employee'));
create policy employees_read on public.employees for select to authenticated using(public.current_app_role() in ('owner','manager') or user_id=auth.uid());
create policy employees_insert on public.employees for insert to authenticated with check(public.current_app_role() in ('owner','manager') and user_id is null);
create policy employees_update on public.employees for update to authenticated using(public.current_app_role() in ('owner','manager')) with check(public.current_app_role() in ('owner','manager'));
create policy tasks_read on public.tasks for select to authenticated using(public.current_app_role() in ('owner','manager') or employee_id in(select id from public.employees where user_id=auth.uid()) or id in(select task_id from public.review_requests where reviewer_id in(select id from public.employees where user_id=auth.uid())));
create policy tasks_insert on public.tasks for insert to authenticated with check(public.current_app_role() in ('owner','manager') and assigned_by=auth.uid());
create policy tasks_update on public.tasks for update to authenticated using(public.current_app_role() in ('owner','manager') or employee_id in(select id from public.employees where user_id=auth.uid() and archived_at is null)) with check(public.current_app_role() in ('owner','manager') or employee_id in(select id from public.employees where user_id=auth.uid() and archived_at is null));
create policy attendance_read on public.attendance for select to authenticated using(public.current_app_role() in ('owner','manager') or employee_id in(select id from public.employees where user_id=auth.uid()));
create policy reports_read on public.daily_reports for select to authenticated using(public.current_app_role() in ('owner','manager') or employee_id in(select id from public.employees where user_id=auth.uid()));
create policy activities_read on public.task_activities for select to authenticated using(public.current_app_role() in ('owner','manager') or task_id in(select id from public.tasks));
create policy reviews_read on public.review_requests for select to authenticated using(public.current_app_role() in ('owner','manager') or requested_by=auth.uid() or reviewer_id in(select id from public.employees where user_id=auth.uid()));
create policy settings_read on public.app_settings for select to authenticated using(public.current_app_role() in ('owner','manager'));
create policy settings_owner on public.app_settings for update to authenticated using(public.current_app_role()='owner') with check(public.current_app_role()='owner');

-- Default Supabase grants are replaced with the exact operations used by the app.
revoke all on public.profiles,public.employees,public.tasks,public.attendance,public.daily_reports,public.task_activities,public.review_requests,public.app_settings,public.bot_secrets,public.notification_deliveries from anon, authenticated;
grant select on public.profiles,public.employees,public.tasks,public.attendance,public.daily_reports,public.task_activities,public.review_requests,public.app_settings to authenticated;
grant insert on public.employees,public.tasks to authenticated;
grant update on public.profiles,public.employees,public.tasks,public.app_settings to authenticated;
grant all on public.profiles,public.employees,public.tasks,public.attendance,public.daily_reports,public.task_activities,public.review_requests,public.app_settings,public.bot_secrets,public.notification_deliveries to service_role;
create index tasks_employee_status on public.tasks(employee_id,status);
create index attendance_employee_date on public.attendance(employee_id,work_date);
create index reports_date on public.daily_reports(report_date desc);
create index activities_task_date on public.task_activities(task_id,created_at desc);
create index employees_user on public.employees(user_id);
create index reviews_task on public.review_requests(task_id);
alter publication supabase_realtime add table public.employees,public.tasks,public.attendance,public.daily_reports,public.task_activities,public.app_settings;
commit;
