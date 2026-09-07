export type Role = "owner" | "manager" | "employee";
export type TaskStatus = "todo" | "in_progress" | "done";
export type Employee = {
  id: string;
  user_id: string | null;
  name: string;
  phone: string;
  profession: string;
  telegram_id: string;
  daily_hours: number;
  joined_on: string;
  archived_at: string | null;
  created_at: string;
};
export type Profile = { id: string; name: string; role: Role };
export type Task = {
  id: string;
  title: string;
  description: string;
  employee_id: string;
  assigned_by: string | null;
  status: TaskStatus;
  priority: "low" | "medium" | "high";
  due_date: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};
export type Attendance = {
  id: string;
  employee_id: string;
  work_date: string;
  attendance_seconds: number;
  active_seconds: number;
  started_at: string;
  ended_at: string | null;
  updated_at: string;
};
export type Report = {
  id: string;
  employee_id: string;
  report_date: string;
  summary: string;
  attendance_seconds: number;
  active_seconds: number;
  created_at: string;
};
export type Activity = {
  id: string;
  task_id: string;
  actor_name: string;
  action: string;
  created_at: string;
};
export type Settings = {
  organization_name: string;
  work_days: number[];
  telegram_enabled: boolean;
  bot_configured?: boolean;
  server_ready?: boolean;
};
export type AppData = {
  profile: Profile;
  employees: Employee[];
  tasks: Task[];
  attendance: Attendance[];
  reports: Report[];
  activities: Activity[];
  settings: Settings;
};
