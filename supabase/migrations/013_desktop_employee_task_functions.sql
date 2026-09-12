begin;

-- السماح للموظف بتعديل/حذف المهام التي أضافها هو فقط (غير الحالة)
create or replace function public.track_task_change() returns trigger language plpgsql security definer set search_path = '' as $$
declare actor text; label text;
begin
  if tg_op='UPDATE' and public.current_app_role()='employee'
     and old.assigned_by is distinct from auth.uid()
     and (to_jsonb(new)-array['status','updated_at','completed_at']) is distinct from (to_jsonb(old)-array['status','updated_at','completed_at']) then raise exception 'Only status can change'; end if;
  if not exists(select 1 from public.employees where id=new.employee_id and archived_at is null) then raise exception 'Employee is archived'; end if;
  if tg_op='INSERT' then
    new.assigned_by=auth.uid(); new.status='todo'; new.completed_at=null; label='أسند مهمة جديدة';
  elsif new.status is distinct from old.status then
    new.completed_at=case when new.status='done' then now() else null end;
    label=case new.status when 'done' then 'أنجز المهمة' when 'in_progress' then 'بدأ العمل على المهمة' else 'أعاد المهمة إلى المطلوب' end;
  else new.completed_at=old.completed_at; end if;
  new.updated_at=now(); return new;
end $$;

-- قائمة الزملاء المتاحين للاختيار في الدسكتوب (بدون معلومات حساسة)
create or replace function public.task_directory()
returns table (id uuid, name text, profession text)
language sql stable security definer set search_path = ''
as $$
  select e.id, e.name, e.profession
  from public.employees e
  where e.archived_at is null
  order by e.name;
$$;
revoke execute on function public.task_directory() from public;
grant execute on function public.task_directory() to authenticated;

-- ضمان صلاحية الوصول لدوال المهام الذاتية الموجودة
grant execute on function public.save_employee_task(uuid, boolean, text, text, text, date, uuid[]) to authenticated;
revoke execute on function public.save_employee_task(uuid, boolean, text, text, text, date, uuid[]) from public;

commit;