import type { AppData } from "./types";
import { todayInBaghdad } from "./metrics";
export function createDemo(): AppData {
  const today = todayInBaghdad();
  const month = today.slice(0, 7);
  const now = new Date().toISOString();
  const names = [
    "أحمد علي",
    "زينب مصطفى",
    "محمد حسن",
    "نور حسين",
    "علي كريم",
    "مريم أحمد",
  ];
  const professions = [
    "مصمم واجهات",
    "مطوّرة ويب",
    "مصمم جرافيك",
    "كاتبة محتوى",
    "مونتير فيديو",
    "إدارة المحتوى",
  ];
  const employees = names.map((name, i) => ({
    id: `demo-employee-${i}`,
    user_id: null,
    name,
    profession: professions[i],
    phone: "",
    telegram_id: "",
    daily_hours: 8,
    joined_on: `${month}-01`,
    archived_at: null,
    created_at: now,
  }));
  const titles = [
    "تصميم الصفحة الرئيسية",
    "تطوير لوحة الإحصائيات",
    "هوية حملة سبتمبر",
    "كتابة محتوى الموقع",
    "مونتاج الفيديو التعريفي",
    "مراجعة خطة المحتوى",
    "تصميم صفحة الخدمات",
    "تحسين تجربة تسجيل الدخول",
    "تصميم منشورات التواصل",
  ];
  const tasks = titles.map((title, i) => ({
    id: `demo-task-${i}`,
    title,
    description: [
      "تجهيز النسخة الأولى ومراجعة التفاصيل مع الفريق.",
      "متابعة التنفيذ وفق المتطلبات المعتمدة.",
    ][i % 2],
    employee_id: employees[i % 6].id,
    assignee_ids: [employees[i % 6].id],
    assigned_by: "demo-owner",
    status: (
      [
        "in_progress",
        "in_progress",
        "todo",
        "done",
        "in_progress",
        "done",
        "todo",
        "done",
        "todo",
      ] as const
    )[i],
    priority: (["high", "medium", "low"] as const)[i % 3],
    due_date: `${month}-${String(Math.min(28, Number(today.slice(-2)) + (i % 4))).padStart(2, "0")}`,
    created_at: now,
    updated_at: now,
    completed_at: [3, 5, 7].includes(i) ? now : null,
  }));
  const attendance = employees.flatMap((e, i) =>
    Array.from({ length: Number(today.slice(-2)) }, (_, d) => d + 1)
      .filter(
        (d) =>
          ![5, 6].includes(
            new Date(
              `${month}-${String(d).padStart(2, "0")}T12:00:00Z`,
            ).getUTCDay(),
          ),
      )
      .map((d) => ({
        id: `demo-attendance-${i}-${d}`,
        employee_id: e.id,
        work_date: `${month}-${String(d).padStart(2, "0")}`,
        attendance_seconds: (7 + ((i + d) % 3) * 0.5) * 3600,
        active_seconds: (5 + ((i + d) % 4) * 0.5) * 3600,
        started_at: `${month}-${String(d).padStart(2, "0")}T06:00:00Z`,
        ended_at: now,
        updated_at: now,
      })),
  );
  return {
    profile: {
      id: "demo-owner",
      name: "مصطفى",
      role: "owner",
      can_follow_tasks: false,
    },
    employees,
    tasks,
    attendance,
    reports: employees
      .slice(0, 4)
      .map((e, i) => ({
        id: `demo-report-${i}`,
        employee_id: e.id,
        report_date: today,
        summary: [
          "أنجزت تصميم الصفحة الرئيسية، وراجعت ملاحظات الفريق على تجربة المستخدم.",
          "اكتمل تطوير المكونات الأساسية، والعمل مستمر على تحسين الأداء.",
          "تم تجهيز تصاميم الحملة ومراجعة الألوان والخطوط.",
          "أنجزت المحتوى المطلوب مع تدقيق النصوص وإعداد خطة الغد.",
        ][i],
        attendance_seconds: 28800,
        active_seconds: 23400,
        created_at: now,
      })),
    activities: tasks
      .slice(0, 5)
      .map((t, i) => ({
        id: `demo-activity-${i}`,
        task_id: t.id,
        actor_name: employees[i].name,
        action: i % 2 ? "بدأ العمل على المهمة" : "أضاف تحديثًا على المهمة",
        created_at: now,
      })),
    settings: {
      organization_name: "المصطفى",
      work_days: [0, 1, 2, 3, 4],
      telegram_enabled: false,
      idle_threshold_minutes: 10,
      bot_configured: false,
      server_ready: false,
    },
  };
}
