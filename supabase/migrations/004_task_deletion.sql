begin;

-- Keep deletion atomic and restricted to administrators, including direct RPC calls.
create function public.delete_task(target_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare caller_role text;
begin
  caller_role = public.current_app_role();
  if caller_role is null or caller_role not in ('owner', 'manager') then
    raise exception 'Administrator required' using errcode = '42501';
  end if;

  perform 1 from public.tasks where id = target_id for update;
  if not found then
    raise exception 'Task not found' using errcode = 'P0002';
  end if;

  -- Delivery event IDs are polymorphic and have no foreign key cascade.
  delete from public.notification_deliveries
  where event_id in (select id from public.task_activities where task_id = target_id)
     or event_id in (select id from public.review_requests where task_id = target_id);

  -- Activities and review requests cascade; employee attendance and reports remain.
  delete from public.tasks where id = target_id;
  return target_id;
end $$;

revoke all on function public.delete_task(uuid) from public;
grant execute on function public.delete_task(uuid) to authenticated;
commit;
