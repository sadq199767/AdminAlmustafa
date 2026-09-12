begin;

create policy task_assignees_update on public.task_assignees for update to authenticated
using (
  public.current_app_role() in ('owner','management','supervisor')
  or task_id in (select id from public.tasks where assigned_by = auth.uid())
)
with check (
  public.current_app_role() in ('owner','management','supervisor')
  or task_id in (select id from public.tasks where assigned_by = auth.uid())
);

commit;