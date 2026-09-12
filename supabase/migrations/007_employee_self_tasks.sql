create policy tasks_insert_own on public.tasks for insert to authenticated
  with check (public.current_app_role() = 'employee'
    and assigned_by = auth.uid()
    and employee_id in (
      select id from public.employees
      where user_id = auth.uid() and archived_at is null
    ));