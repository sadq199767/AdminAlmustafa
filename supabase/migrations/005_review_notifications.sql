begin;
-- Review requests join the same activity feed used by the notification bell and Realtime.
create function public.record_review_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
declare requester_name text; reviewer_name text;
begin
  select name into requester_name from public.profiles where id = new.requested_by;
  select name into reviewer_name from public.employees where id = new.reviewer_id;
  insert into public.task_activities(task_id, actor_id, actor_name, action)
  values(new.task_id, new.requested_by, coalesce(requester_name, 'عضو الفريق'),
    'طلب مراجعة من ' || coalesce(reviewer_name, 'عضو الفريق'));
  return new;
end $$;
revoke all on function public.record_review_activity() from public;
create trigger review_activity after insert on public.review_requests
for each row execute function public.record_review_activity();
commit;
