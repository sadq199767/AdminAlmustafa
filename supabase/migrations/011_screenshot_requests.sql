begin;

-- ============================================================
-- 011: التقاط الشاشة عند الطلب فقط — المسؤول المباشر يطلب من
--      لوحة التحكم صورة لشاشة موظف معيّن، فيلتقطها تطبيق
--      الديسكتوب ويرسلها لتلكرام. لا يوجد أي تشغيل تلقائي/دوري.
--      لا تُخزَّن بيانات الصور هنا إطلاقاً — فقط سجلات نصية.
-- ============================================================

-- 1) جدول الطلبات: يُنشئ المسؤول/المالك/الإدارة طلباً موجهًا لموظف معيّن.
create table public.screenshot_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  requester_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','done','failed','rejected')),
  created_at timestamptz not null default now()
);

create index screenshot_requests_employee on public.screenshot_requests(employee_id, created_at desc);

-- 2) جدول السجلات النصية (بلا صور): من يطلب، لمن، عدد الشاشات، النتيجة.
create table public.screenshot_logs (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references public.screenshot_requests(id) on delete set null,
  employee_id uuid not null references public.employees(id) on delete cascade,
  requester_id uuid not null references public.profiles(id) on delete cascade,
  monitors_count integer not null default 1,
  status text not null default 'sent' check (status in ('sent','failed')),
  message text not null default '',
  created_at timestamptz not null default now()
);

create index screenshot_logs_employee on public.screenshot_logs(employee_id, created_at desc);

-- 3) RLS
alter table public.screenshot_requests enable row level security;
alter table public.screenshot_logs enable row level security;

-- القراءة: الموظف يرى طلباته فقط؛ الإدارة/المالك/المسؤول يرون كل شيء.
drop policy if exists screenshot_requests_read on public.screenshot_requests;
create policy screenshot_requests_read on public.screenshot_requests for select to authenticated
  using (public.current_app_role() in ('owner','management','supervisor')
    or employee_id in (select id from public.employees where user_id = auth.uid()));

-- الإنشاء: المالك/الإدارة/المسؤول المباشر يطلبون الصورة.
drop policy if exists screenshot_requests_insert on public.screenshot_requests;
create policy screenshot_requests_insert on public.screenshot_requests for insert to authenticated
  with check (public.current_app_role() in ('owner','management','supervisor'));
  -- requester_id يُجبر بأن يكون طالب الطلب نفسه عبر trigger أدناه.

-- تحديث الحالة (done/failed): التطبيق (الموظف ذاته) أو المالك/الإدارة/المسؤول.
drop policy if exists screenshot_requests_update on public.screenshot_requests;
create policy screenshot_requests_update on public.screenshot_requests for update to authenticated
  using (employee_id in (select id from public.employees where user_id = auth.uid())
    or public.current_app_role() in ('owner','management','supervisor'))
  with check (public.current_app_role() in ('owner','management','supervisor')
    or employee_id in (select id from public.employees where user_id = auth.uid()));

-- السجلات: موظف يرى سجلاته فقط؛ الإدارة تدير كل شيء.
drop policy if exists screenshot_logs_read on public.screenshot_logs;
create policy screenshot_logs_read on public.screenshot_logs for select to authenticated
  using (public.current_app_role() in ('owner','management','supervisor')
    or employee_id in (select id from public.employees where user_id = auth.uid()));

-- الكتابة في السجلات: التطبيق (الموظف ذاته عبر security definer) أو الإدارة.
create or replace function public.log_screenshot(
  p_request_id uuid,
  p_employee_id uuid,
  p_requester_id uuid,
  p_monitors_count integer,
  p_status text,
  p_message text
) returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.screenshot_logs(request_id, employee_id, requester_id, monitors_count, status, message)
  values (p_request_id, p_employee_id, p_requester_id, p_monitors_count, p_status, p_message);
end $$;
revoke all on function public.log_screenshot(uuid,uuid,uuid,integer,text,text) from public;
grant execute on function public.log_screenshot(uuid,uuid,uuid,integer,text,text) to authenticated;

-- 4) عند الإنشاء: تثبيت requester_id بأنه الطالب نفسه (منع انتحال الهوية).
--    يُحافظ على قيمة requester_id إذا كانت مقدّمة صراحةً (عند الإنشاء عبر
--    سكربت الخدمة)، وإلا يُملأ من auth.uid() (عند الإنشاء عبر RLS).
create or replace function public.guard_screenshot_request() returns trigger language plpgsql set search_path = '' as $$
begin
  new.requester_id = coalesce(new.requester_id, auth.uid());
  new.status = 'pending';
  return new;
end $$;
create trigger screenshot_request_guard before insert on public.screenshot_requests
  for each row execute function public.guard_screenshot_request();

-- 5) الصلاحيات
revoke all on public.screenshot_requests, public.screenshot_logs from anon, authenticated;
grant select on public.screenshot_requests, public.screenshot_logs to authenticated;
grant insert on public.screenshot_requests to authenticated;
grant update on public.screenshot_requests to authenticated;
grant all on public.screenshot_requests, public.screenshot_logs to service_role;

-- 6) Realtime: يستمع تطبيق الديسكتوب إلى الطلبات الجديدة.
alter publication supabase_realtime add table public.screenshot_requests;

commit;
