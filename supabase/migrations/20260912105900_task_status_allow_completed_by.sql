create or replace function public.track_task_change() returns trigger
language plpgsql security definer set search_path = '' as $function$
begin
  if auth.uid() is not null and exists(select 1 from public.app_settings where system_suspended) then
    raise exception 'The system is paused by the owner.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and public.current_app_role() = 'employee' then
    if old.assigned_by = auth.uid() then
      if (to_jsonb(new) - array['title','description','employee_id','priority','due_date','status','updated_at','completed_at','completed_by'])
         is distinct from (to_jsonb(old) - array['title','description','employee_id','priority','due_date','status','updated_at','completed_at','completed_by']) then
        raise exception 'The task creator cannot be changed.' using errcode = '42501';
      end if;
    elsif (to_jsonb(new) - array['status','updated_at','completed_at','completed_by'])
          is distinct from (to_jsonb(old) - array['status','updated_at','completed_at','completed_by']) then
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
end $function$;