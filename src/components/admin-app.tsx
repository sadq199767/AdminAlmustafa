"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LayoutDashboard,
  Users,
  Columns3,
  FileText,
  Settings,
  Search,
  Plus,
  ArrowUpLeft,
  ArrowDownToLine,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Check,
  X,
  Clock3,
  Timer,
  CircleCheck,
  LogOut,
  Menu,
  MoreHorizontal,
  ArrowRight,
  Send,
  ShieldCheck,
  CalendarDays,
  SlidersHorizontal,
  CircleHelp,
  RefreshCw,
  BriefcaseBusiness,
  Sparkles,
  CheckCheck,
  Pencil,
  Trash2,
  Eye,
  LayoutGrid,
  List,
  Circle,
  Activity as ActivityIcon,
  LockKeyhole,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type {
  AppData,
  Employee,
  Task,
  TaskStatus,
  Report,
  Profile,
} from "@/lib/types";
import { createDemo } from "@/lib/demo";
import { employeeMetrics, hours, todayInBaghdad } from "@/lib/metrics";
import { configured, supabase } from "@/lib/supabase";
import { ThemeToggle } from "@/components/theme-provider";
import { NotificationBell } from "@/components/notification-bell";

type Page = "dashboard" | "employees" | "tasks" | "reports" | "settings";
type Modal =
  | { type: "employee"; employee?: Employee }
  | { type: "task" }
  | { type: "employee-detail"; employee: Employee }
  | { type: "report"; report: Report }
  | { type: "task-detail"; task: Task }
  | { type: "delete-task"; task: Task }
  | { type: "delete"; employee: Employee }
  | { type: "account"; employee: Employee }
  | null;
const pages: { id: Page; name: string; icon: LucideIcon }[] = [
  { id: "dashboard", name: "نظرة عامة", icon: LayoutDashboard },
  { id: "employees", name: "الموظفون", icon: Users },
  { id: "tasks", name: "المهام", icon: Columns3 },
  { id: "reports", name: "التقارير اليومية", icon: FileText },
  { id: "settings", name: "الإعدادات", icon: Settings },
];
const pageIds = new Set<Page>(pages.map((entry) => entry.id));
function pageFromLocation(): Page {
  if (typeof window === "undefined") return "dashboard";
  const value = new URLSearchParams(window.location.search).get("section");
  return value && pageIds.has(value as Page) ? (value as Page) : "dashboard";
}
const statusNames: Record<TaskStatus, string> = {
  todo: "مطلوب",
  in_progress: "قيد العمل",
  done: "منجز",
};
const priorityNames = { low: "منخفضة", medium: "متوسطة", high: "عالية" };
const num = (n: number) =>
  new Intl.NumberFormat("ar-IQ-u-nu-latn", { maximumFractionDigits: 1 }).format(
    n,
  );
const dateLabel = (date: string) =>
  new Intl.DateTimeFormat("ar-IQ-u-nu-latn", {
    day: "numeric",
    month: "long",
    timeZone: "Asia/Baghdad",
  }).format(new Date(date.length === 10 ? `${date}T12:00:00Z` : date));
const avatarColors = ["sage", "peach", "lilac", "blue", "rose", "yellow"];
function Avatar({
  name,
  index = 0,
  small = false,
}: {
  name: string;
  index?: number;
  small?: boolean;
}) {
  return (
    <span
      className={`avatar ${avatarColors[index % 6]} ${small ? "small" : ""}`}
    >
      {name
        .split(" ")
        .slice(0, 2)
        .map((n) => n[0])
        .join("")}
    </span>
  );
}
function Empty({
  icon: Icon = FileText,
  title,
  body,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <span>
        <Icon size={26} />
      </span>
      <h3>{title}</h3>
      <p>{body}</p>
      {action}
    </div>
  );
}
function csv(filename: string, rows: (string | number)[][]) {
  const content =
    "\uFEFF" +
    rows
      .map((row) =>
        row
          .map((v) => {
            let s = String(v);
            if (/^[=+@\-\t\r]/.test(s)) s = "'" + s;
            return '"' + s.replaceAll('"', '""') + '"';
          })
          .join(","),
      )
      .join("\r\n");
  const url = URL.createObjectURL(
    new Blob([content], { type: "text/csv;charset=utf-8;" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function AdminApp({
  initialDemo = false,
}: {
  initialDemo?: boolean;
}) {
  const [data, setData] = useState<AppData | null>(null);
  const demo = initialDemo;
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState<Page>(pageFromLocation);
  const [search, setSearch] = useState("");
  const [month, setMonth] = useState(todayInBaghdad().slice(0, 7));
  const [modal, setModal] = useState<Modal>(null);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [taskFilter, setTaskFilter] = useState("all");
  const [taskView, setTaskView] = useState<"board" | "list">("board");
  const [reportEmployee, setReportEmployee] = useState("all");
  const [notices, setNotices] = useState(false);
  const [authError, setAuthError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [team, setTeam] = useState<Profile[]>([]);
  const dialog = useRef<HTMLDialogElement>(null);
  const notify = useCallback(
    (text: string, error = false) => setToast({ text, error }),
    [],
  );
  const api = useCallback(
    async (path: string, method = "GET", body?: unknown) => {
      if (!supabase) throw new Error("لم يكتمل إعداد الاتصال بقاعدة البيانات.");
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("يرجى تسجيل الدخول مجددًا.");
      const res = await fetch(`/api/${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "تعذّر إتمام العملية.");
      return result;
    },
    [],
  );
  const reload = useCallback(async () => {
    try {
      const result = await api("data");
      setData(result);
      setLoadError("");
    } catch (e) {
      setLoadError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [api]);
  useEffect(() => {
    const value = pageFromLocation();
    setPage(value);
  }, []);
  useEffect(() => {
    if (initialDemo) {
      try {
        const saved = localStorage.getItem("almustafa-demo-v1");
        setData(saved ? JSON.parse(saved) : createDemo());
      } catch {
        setData(createDemo());
      }
      setLoading(false);
      return;
    }
    if (!supabase) {
      setLoading(false);
      return;
    }
    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) void reload();
      else setLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === "SIGNED_OUT") {
          setData(null);
          setLoading(false);
        } else if (session && event === "SIGNED_IN")
          setTimeout(() => void reload(), 0);
      },
    );
    return () => listener.subscription.unsubscribe();
  }, [initialDemo, reload]);
  useEffect(() => {
    if (demo && data)
      localStorage.setItem("almustafa-demo-v1", JSON.stringify(data));
  }, [data, demo]);
  useEffect(() => {
    if (!demo && data && supabase) {
      const channel = supabase.channel("admin-live");
      for (const table of [
        "employees",
        "tasks",
        "attendance",
        "daily_reports",
        "task_activities",
        "app_settings",
      ])
        channel.on(
          "postgres_changes",
          { event: "*", schema: "public", table },
          () => void reload(),
        );
      channel.subscribe();
      const timer = setInterval(() => void reload(), 60000);
      return () => {
        void supabase?.removeChannel(channel);
        clearInterval(timer);
      };
    }
  }, [demo, data?.profile.id, reload]);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  useEffect(() => {
    if (modal && !dialog.current?.open) dialog.current?.showModal();
    else if (!modal && dialog.current?.open) dialog.current.close();
  }, [modal]);
  useEffect(() => {
    if (page === "settings" && !demo && data?.profile.role === "owner")
      void api("team")
        .then(setTeam)
        .catch((e) => notify(e.message, true));
  }, [page, demo, data?.profile.role, api, notify]);
  const changePage = (p: Page) => {
    setPage(p);
    const url = new URL(window.location.href);
    if (p === "dashboard") url.searchParams.delete("section");
    else url.searchParams.set("section", p);
    window.history.replaceState(
      null,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
    setSearch("");
    setMobile(false);
    setNotices(false);
  };
  const mutate = async (operation: () => Promise<void>) => {
    setBusy(true);
    try {
      await operation();
      setModal(null);
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  const saveEmployee = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const input = {
      name: String(values.get("name")),
      profession: String(values.get("profession")),
      phone: String(values.get("phone")),
      telegram_id: String(values.get("telegram_id")),
      daily_hours: Number(values.get("daily_hours")),
      joined_on: String(values.get("joined_on")),
    };
    void mutate(async () => {
      const existing = modal?.type === "employee" ? modal.employee : undefined;
      if (demo) {
        setData((d) =>
          d
            ? {
                ...d,
                employees: existing
                  ? d.employees.map((e) =>
                      e.id === existing.id ? { ...e, ...input } : e,
                    )
                  : [
                      ...d.employees,
                      {
                        ...input,
                        id: crypto.randomUUID(),
                        user_id: null,
                        archived_at: null,
                        created_at: new Date().toISOString(),
                      },
                    ],
              }
            : d,
        );
      } else {
        await api(
          existing ? `employees/${existing.id}` : "employees",
          existing ? "PATCH" : "POST",
          input,
        );
        await reload();
      }
      notify(
        existing ? "تم تحديث بيانات الموظف" : "تمت إضافة الموظف إلى الفريق",
      );
    });
  };
  const saveTask = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const input = {
      title: String(values.get("title")),
      description: String(values.get("description")),
      employee_id: String(values.get("employee_id")),
      priority: String(values.get("priority")) as Task["priority"],
      due_date: String(values.get("due_date")) || null,
    };
    void mutate(async () => {
      if (demo) {
        const now = new Date().toISOString();
        const taskId = crypto.randomUUID();
        setData((d) =>
          d
            ? {
                ...d,
                tasks: [
                  {
                    ...input,
                    id: taskId,
                    status: "todo",
                    assigned_by: d.profile.id,
                    created_at: now,
                    updated_at: now,
                    completed_at: null,
                  },
                  ...d.tasks,
                ],
                activities: [
                  {
                    id: crypto.randomUUID(),
                    task_id: taskId,
                    actor_name: d.profile.name,
                    action: "أسند مهمة جديدة",
                    created_at: now,
                  },
                  ...d.activities,
                ],
              }
            : d,
        );
        notify("تم إسناد المهمة في المعاينة");
      } else {
        const result = await api("tasks", "POST", input);
        await reload();
        notify(
          result.notification === "failed"
            ? "تم حفظ المهمة، لكن تعذّر إرسال إشعار تلكرام."
            : result.notification === "sent"
              ? "تم إسناد المهمة وإرسال إشعار تلكرام"
              : "تم إسناد المهمة؛ إشعارات تلكرام غير مهيأة أو معطلة.",
          result.notification === "failed",
        );
      }
    });
  };
  const updateStatus = async (task: Task, status: TaskStatus) => {
    if (task.status === status) return;
    setBusy(true);
    try {
      if (demo)
        setData((d) =>
          d
            ? {
                ...d,
                tasks: d.tasks.map((t) =>
                  t.id === task.id
                    ? {
                        ...t,
                        status,
                        updated_at: new Date().toISOString(),
                        completed_at:
                          status === "done" ? new Date().toISOString() : null,
                      }
                    : t,
                ),
                activities: [
                  {
                    id: crypto.randomUUID(),
                    task_id: task.id,
                    actor_name: d.profile.name,
                    action: `غيّر الحالة إلى ${statusNames[status]}`,
                    created_at: new Date().toISOString(),
                  },
                  ...d.activities,
                ],
              }
            : d,
        );
      else {
        const result = await api(`tasks/${task.id}`, "PATCH", { status });
        await reload();
        if (result.notification === "failed") {
          notify("تم تغيير الحالة، لكن تعذّر إرسال الإشعار.", true);
          return;
        }
      }
      notify(`تم تغيير حالة المهمة إلى «${statusNames[status]}»`);
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  const deleteTask = (task: Task) =>
    void mutate(async () => {
      if (!demo) await api(`tasks/${task.id}`, "DELETE");
      setData((d) =>
        d
          ? {
              ...d,
              tasks: d.tasks.filter((t) => t.id !== task.id),
              activities: d.activities.filter((a) => a.task_id !== task.id),
            }
          : d,
      );
      if (!demo) await reload();
      notify(demo ? "تم حذف المهمة من المعاينة" : "تم حذف المهمة نهائيًا");
    });
  const deleteEmployee = (employee: Employee) =>
    void mutate(async () => {
      if (demo)
        setData((d) => {
          if (!d) return d;
          const removedTasks = new Set(
            d.tasks
              .filter((t) => t.employee_id === employee.id)
              .map((t) => t.id),
          );
          return {
            ...d,
            employees: d.employees.filter((e) => e.id !== employee.id),
            tasks: d.tasks.filter((t) => t.employee_id !== employee.id),
            attendance: d.attendance.filter(
              (a) => a.employee_id !== employee.id,
            ),
            reports: d.reports.filter((r) => r.employee_id !== employee.id),
            activities: d.activities.filter(
              (a) => !removedTasks.has(a.task_id),
            ),
          };
        });
      else {
        const result = await api("employees/" + employee.id, "DELETE");
        await reload();
        if (result.auth_cleanup_pending) {
          notify(
            "تم حذف الموظف وإلغاء وصوله. يحتاج سجل تسجيل الدخول إلى تنظيف من Supabase.",
            true,
          );
          return;
        }
      }
      notify("تم حذف الموظف وسجلاته المرتبطة نهائيًا");
    });
  const activeEmployees = data?.employees.filter((e) => !e.archived_at) || [];
  const metrics = useMemo(
    () =>
      data
        ? activeEmployees.map((e) => ({
            ...employeeMetrics(data, e, month),
            employee: e,
          }))
        : [],
    [data, month],
  );
  const totals = metrics.reduce(
    (a, m) => ({
      attendance: a.attendance + m.attendance,
      active: a.active + m.active,
      required: a.required + m.required,
      completed: a.completed + m.completed,
    }),
    { attendance: 0, active: 0, required: 0, completed: 0 },
  );
  const filteredEmployees = (data?.employees || []).filter((e) =>
    `${e.name} ${e.profession} ${e.phone}`.includes(search),
  );
  const filteredTasks = (data?.tasks || []).filter(
    (t) =>
      (taskFilter === "all" || t.employee_id === taskFilter) &&
      `${t.title} ${data?.employees.find((e) => e.id === t.employee_id)?.name}`.includes(
        search,
      ),
  );
  const filteredReports = (data?.reports || []).filter(
    (r) =>
      r.report_date.startsWith(month) &&
      (reportEmployee === "all" || r.employee_id === reportEmployee) &&
      `${r.summary} ${data?.employees.find((e) => e.id === r.employee_id)?.name}`.includes(
        search,
      ),
  );
  const monthlyTasks = (data?.tasks || []).filter(
    (t) =>
      todayInBaghdad(new Date(t.created_at)).slice(0, 7) === month ||
      (t.completed_at &&
        todayInBaghdad(new Date(t.completed_at)).slice(0, 7) === month),
  );
  const completedCount = monthlyTasks.filter((t) => t.status === "done").length;
  const exportData = () => {
    if (!data) return;
    if (page === "reports") {
      csv(`التقارير-${month}.csv`, [
        ["الموظف", "التاريخ", "الملخص", "ساعات الدوام", "وقت العمل"],
        ...filteredReports.map((r) => [
          data.employees.find((e) => e.id === r.employee_id)?.name || "",
          r.report_date,
          r.summary,
          hours(r.attendance_seconds),
          hours(r.active_seconds),
        ]),
      ]);
    } else {
      csv(`أداء-الفريق-${month}.csv`, [
        [
          "الموظف",
          "المهنة",
          "ساعات الدوام",
          "وقت العمل",
          "الساعات المطلوبة حتى اليوم",
          "نسبة الدوام",
          "المهام المنجزة",
        ],
        ...metrics.map((m) => [
          m.employee.name,
          m.employee.profession,
          hours(m.attendance),
          hours(m.active),
          m.required,
          `${m.percent}%`,
          m.completed,
        ]),
      ]);
    }
    notify("تم تنزيل التقرير");
  };
  if (loading)
    return (
      <div className="loading-screen">
        <div className="brand-symbol">م</div>
        <span className="spinner" />
        <p>نجهّز مساحة عملك…</p>
      </div>
    );
  if (!data)
    return (
      <div className="login-page">
        <ThemeToggle className="login-theme-toggle" />
        <div className="login-story">
          <div className="brand light">
            <div className="brand-symbol">م</div>
            <strong>
              المصطفى<span>مساحة إدارة الفريق</span>
            </strong>
          </div>
          <div>
            <span className="eyebrow">كل شيء في مكانه</span>
            <h1>
              فريق متصل.
              <br />
              عمل أكثر وضوحًا.
            </h1>
            <p>
              تابع فريقك، نظّم المهام، واطّلع على ما أُنجز.
              <br />
              مساحة هادئة للعمل الذي يستحق تركيزك.
            </p>
            <div className="login-preview">
              <span>
                <CircleCheck />
                مهام واضحة
              </span>
              <span>
                <Timer />
                وقت محسوب
              </span>
              <span>
                <Users />
                فريق واحد
              </span>
            </div>
          </div>
          <small>المصطفى © {new Date().getFullYear()}</small>
        </div>
        <main className="login-form">
          <div className="login-form-inner">
            <span className="login-icon">
              <LockKeyhole size={26} />
            </span>
            <h2>أهلًا بعودتك</h2>
            <p>سجّل دخولك إلى مساحة إدارة الفريق.</p>
            {(authError || loadError) && (
              <div className="alert error">{authError || loadError}</div>
            )}
            {!configured && (
              <div className="alert">
                الواجهة جاهزة. يحتاج الدخول الحقيقي إلى استكمال إعداد الاتصال بـ
                Supabase.
              </div>
            )}
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setAuthError("");
                const f = new FormData(e.currentTarget);
                try {
                  if (!supabase)
                    throw new Error(
                      "أكمل إعداد Supabase أولًا، أو افتح المعاينة.",
                    );
                  const { error } = await supabase.auth.signInWithPassword({
                    email: String(f.get("email")),
                    password: String(f.get("password")),
                  });
                  if (error)
                    throw new Error(
                      "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
                    );
                  await reload();
                } catch (err) {
                  setAuthError((err as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label>
                البريد الإلكتروني
                <input
                  name="email"
                  type="email"
                  dir="ltr"
                  placeholder="name@company.com"
                  autoComplete="username"
                  required
                />
              </label>
              <label>
                كلمة المرور
                <input
                  name="password"
                  type="password"
                  dir="ltr"
                  placeholder="••••••••••••"
                  autoComplete="current-password"
                  required
                />
              </label>
              <button
                className="button primary full"
                disabled={busy || !configured}
              >
                {busy ? "جارٍ تسجيل الدخول…" : "تسجيل الدخول"}
                <ArrowUpLeft size={18} />
              </button>
            </form>
            <div className="login-divider">
              <span>تعرّف على مساحة العمل</span>
            </div>
            <a className="button secondary full" href="/demo">
              استكشاف النسخة التجريبية <ArrowLeftIcon />
            </a>
            <small className="login-note">
              <ShieldCheck size={15} /> الدخول مخصص للمالك والمدير فقط
            </small>
          </div>
        </main>
      </div>
    );
  return (
    <div className="app-shell">
      {mobile && (
        <button
          className="sidebar-overlay"
          aria-label="إغلاق القائمة"
          onClick={() => setMobile(false)}
        />
      )}
      <aside className={`sidebar ${mobile ? "open" : ""}`}>
        <a className="brand" href={demo ? "/demo" : "/"}>
          <span className="brand-symbol">م</span>
          <strong>
            {data.settings.organization_name}
            <span>مساحة إدارة الفريق</span>
          </strong>
        </a>
        <div className="workspace-label">مساحة العمل</div>
        <nav>
          {pages
            .filter((p) => p.id !== "settings" || data.profile.role === "owner")
            .map(({ id, name, icon: Icon }) => (
              <button
                key={id}
                className={`nav-item ${page === id ? "active" : ""}`}
                onClick={() => changePage(id)}
              >
                <Icon size={20} />
                <span>{name}</span>
                {id === "tasks" && (
                  <b>
                    {num(data.tasks.filter((t) => t.status !== "done").length)}
                  </b>
                )}
                {page === id && <span className="nav-dot" />}
              </button>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="workspace-card">
            <span className="workspace-card-icon">
              <Sparkles size={20} />
            </span>
            <h4>مساحة صغيرة، إنجازات كبيرة</h4>
            <p>
              كل مهمة تنجزها اليوم
              <br />
              تقرّب فريقك من هدفه.
            </p>
            <span className="workspace-decoration" />
          </div>
          <ThemeToggle className="nav-item" />
          <div className="sidebar-profile">
            <Avatar name={data.profile.name} />
            <div>
              <strong>{data.profile.name}</strong>
              <small>
                {data.profile.role === "owner"
                  ? "مالك مساحة العمل"
                  : "مدير الفريق"}
              </small>
            </div>
            <button
              className="icon-button"
              title="تسجيل الخروج"
              aria-label="تسجيل الخروج"
              onClick={async () => {
                if (demo) {
                  location.href = "/";
                } else {
                  await supabase?.auth.signOut();
                  setData(null);
                }
              }}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-toggle"
              aria-label="فتح القائمة"
              onClick={() => setMobile(true)}
            >
              <Menu size={21} />
            </button>
            <span>مساحة العمل</span>
            <ChevronLeft size={14} />
            <strong>{pages.find((p) => p.id === page)?.name}</strong>
          </div>
          <div className="topbar-actions">
            <ThemeToggle />
            <span className={`connection ${demo ? "demo" : ""}`}>
              <i />
              {demo ? "نسخة تجريبية" : "متصل بـ Supabase"}
            </span>
            <span className="topbar-divider" />
            <NotificationBell
              activities={data.activities}
              tasks={data.tasks}
              accountKey={`${demo ? "demo" : "live"}-${data.profile.id}`}
              open={notices}
              onOpenChange={setNotices}
            />
            <Avatar name={data.profile.name} small />
          </div>
        </header>
        <main className="main-content">
          {demo && (
            <div className="demo-banner">
              <span>
                <Sparkles size={16} /> أنت تستكشف بيانات تجريبية. التغييرات
                محفوظة في هذا المتصفح فقط.
              </span>
              <button
                onClick={() => {
                  setData(createDemo());
                  notify("تمت إعادة ضبط بيانات المعاينة");
                }}
              >
                إعادة الضبط
                <RefreshCw size={13} />
              </button>
            </div>
          )}
          {loadError && (
            <div className="alert error">
              {loadError}
              <button onClick={() => void reload()}>إعادة المحاولة</button>
            </div>
          )}
          <section className="page-heading">
            <div>
              <div className="eyebrow">
                {page === "dashboard"
                  ? new Intl.DateTimeFormat("ar-IQ-u-nu-latn", {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                      timeZone: "Asia/Baghdad",
                    }).format(new Date())
                  : "إدارة الفريق، بكل وضوح"}
              </div>
              <h1>
                {page === "dashboard"
                  ? `صباح الإنجاز، ${data.profile.name.split(" ")[0]}`
                  : pages.find((p) => p.id === page)?.name}
                {page === "dashboard" && (
                  <span className="greeting-spark">✳</span>
                )}
              </h1>
              <p>
                {
                  {
                    dashboard:
                      "إليك ما يحدث في فريقك. كل التفاصيل، في نظرة واحدة.",
                    employees:
                      "الأشخاص خلف كل إنجاز. تابع فريقك واهتم بالتفاصيل.",
                    tasks:
                      "من الفكرة إلى الإنجاز. نظّم أولويات فريقك وراقب التقدّم.",
                    reports: "صورة أوضح ليوم العمل، بكلمات فريقك.",
                    settings: "اضبط مساحة العمل بما يناسب طريقة عمل فريقك.",
                  }[page]
                }
              </p>
            </div>
            <div className="heading-actions">
              {["dashboard", "employees", "reports"].includes(page) && (
                <button className="button secondary" onClick={exportData}>
                  <ArrowDownToLine size={17} />
                  تصدير التقرير
                </button>
              )}
              {["dashboard", "tasks"].includes(page) && (
                <button
                  className="button primary"
                  onClick={() => setModal({ type: "task" })}
                >
                  <Plus size={18} />
                  مهمة جديدة
                </button>
              )}
              {page === "employees" && (
                <button
                  className="button primary"
                  onClick={() => setModal({ type: "employee" })}
                >
                  <Plus size={18} />
                  إضافة موظف
                </button>
              )}
            </div>
          </section>
          {page === "dashboard" && (
            <>
              <div className="section-caption">
                <h2>
                  أداء الفريق <span>هذا الشهر</span>
                </h2>
                <MonthPicker
                  label="شهر الإحصائيات"
                  value={month}
                  onChange={setMonth}
                />
              </div>
              <section className="stats-grid">
                <Stat
                  title="إجمالي الموظفين"
                  value={num(activeEmployees.length)}
                  unit="موظف"
                  icon={Users}
                  detail={`${num(activeEmployees.filter((e) => data.tasks.some((t) => t.employee_id === e.id && t.status === "in_progress")).length)} موظفين يعملون على مهام الآن`}
                  featured
                />
                <Stat
                  title="ساعات الدوام"
                  value={num(hours(totals.attendance))}
                  unit="ساعة"
                  icon={Clock3}
                  detail="من الدخول إلى الخروج، شاملة الخمول"
                />
                <Stat
                  title="وقت العمل الفعلي"
                  value={num(hours(totals.active))}
                  unit="ساعة"
                  icon={Timer}
                  detail="وقت التركيز، باستثناء فترات الخمول"
                />
                <Stat
                  title="المهام المنجزة"
                  value={num(totals.completed)}
                  unit="مهمة"
                  icon={CircleCheck}
                  detail="خطوات صغيرة تصنع فارقًا كبيرًا"
                />
              </section>
              <section className="charts-grid">
                <div className="panel attendance-chart">
                  <div className="panel-heading">
                    <div>
                      <h2>إيقاع العمل</h2>
                      <p>
                        ساعات الدوام والعمل الفعلي خلال آخر 7 أيام من الفترة
                      </p>
                    </div>
                    <div className="legend">
                      <span>
                        <i />
                        الدوام
                      </span>
                      <span>
                        <i />
                        العمل الفعلي
                      </span>
                    </div>
                  </div>
                  <WorkChart data={data} month={month} />
                  <div className="chart-footer">
                    <span>
                      <span className="tiny-dot" />
                      نسبة العمل الفعلي إلى الدوام
                    </span>
                    <strong>
                      {num(
                        totals.attendance
                          ? Math.round(
                              (totals.active / totals.attendance) * 100,
                            )
                          : 0,
                      )}
                      <small>٪</small>
                    </strong>
                  </div>
                </div>
                <div className="panel completion-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>تقدّم المهام</h2>
                      <p>المهام المرتبطة بالشهر المحدد</p>
                    </div>
                    <span className="subtle-icon">
                      <Columns3 size={19} />
                    </span>
                  </div>
                  <div
                    className="donut"
                    style={
                      {
                        "--progress": `${monthlyTasks.length ? (completedCount / monthlyTasks.length) * 100 : 0}%`,
                      } as React.CSSProperties
                    }
                  >
                    <div>
                      <strong>
                        {num(
                          monthlyTasks.length
                            ? Math.round(
                                (completedCount / monthlyTasks.length) * 100,
                              )
                            : 0,
                        )}
                        <span>٪</span>
                      </strong>
                      <small>نسبة الإنجاز</small>
                    </div>
                  </div>
                  <div className="completion-legend">
                    {(["done", "in_progress", "todo"] as TaskStatus[]).map(
                      (s) => (
                        <div key={s}>
                          <span>
                            <i className={s} />
                            {statusNames[s]}
                          </span>
                          <strong>
                            {num(
                              monthlyTasks.filter((t) => t.status === s).length,
                            )}
                          </strong>
                        </div>
                      ),
                    )}
                  </div>
                </div>
              </section>
              <section className="bottom-grid">
                <div className="panel team-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>الفريق في لمحة</h2>
                      <p>تفاصيل الأداء والدوام الشهري حتى اليوم</p>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => changePage("employees")}
                    >
                      عرض الجميع
                      <ArrowUpLeft size={15} />
                    </button>
                  </div>
                  {activeEmployees.length ? (
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>الموظف</th>
                            <th>الدوام / العمل</th>
                            <th>نسبة الدوام</th>
                            <th>المنجز</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {metrics.slice(0, 5).map((m, i) => (
                            <tr key={m.employee.id}>
                              <td>
                                <button
                                  className="person-cell"
                                  onClick={() =>
                                    setModal({
                                      type: "employee-detail",
                                      employee: m.employee,
                                    })
                                  }
                                >
                                  <Avatar name={m.employee.name} index={i} />
                                  <span>
                                    <strong>{m.employee.name}</strong>
                                    <small>{m.employee.profession}</small>
                                  </span>
                                </button>
                              </td>
                              <td>
                                <div className="hours-cell">
                                  <strong>
                                    {num(hours(m.attendance))}
                                    <small> س</small>
                                  </strong>
                                  <span>/ {num(hours(m.active))} س</span>
                                </div>
                              </td>
                              <td>
                                <div className="progress-cell">
                                  <span>{num(m.percent)}٪</span>
                                  <div>
                                    <i
                                      style={{
                                        width: `${Math.min(100, m.percent)}%`,
                                      }}
                                    />
                                  </div>
                                </div>
                              </td>
                              <td>
                                <span className="count-badge">
                                  {num(m.completed)}
                                </span>
                              </td>
                              <td>
                                <button
                                  className="icon-button"
                                  aria-label={`تفاصيل ${m.employee.name}`}
                                  onClick={() =>
                                    setModal({
                                      type: "employee-detail",
                                      employee: m.employee,
                                    })
                                  }
                                >
                                  <ChevronLeft size={17} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <Empty
                      icon={Users}
                      title="لنبدأ بفريقك"
                      body="أضف الموظف الأول لتظهر إحصائيات الفريق هنا."
                      action={
                        <button
                          className="button primary"
                          onClick={() => setModal({ type: "employee" })}
                        >
                          إضافة موظف
                          <Plus size={16} />
                        </button>
                      }
                    />
                  )}
                </div>
                <div className="panel activity-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>آخر النشاطات</h2>
                      <p>الفريق يتحرّك للأمام</p>
                    </div>
                    <span className="subtle-icon">
                      <ActivityIcon size={19} />
                    </span>
                  </div>
                  {data.activities.length ? (
                    <div className="activity-list">
                      {data.activities.slice(0, 4).map((a, i) => (
                        <div key={a.id} className="activity-item">
                          <span
                            className={`activity-icon ${i % 2 ? "lilac" : "sage"}`}
                          >
                            {i % 2 ? <Timer size={15} /> : <Check size={16} />}
                          </span>
                          <div>
                            <p>
                              <strong>{a.actor_name}</strong> {a.action}
                            </p>
                            <span>
                              {
                                data.tasks.find((t) => t.id === a.task_id)
                                  ?.title
                              }
                            </span>
                            <small>{dateLabel(a.created_at)}</small>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <Empty
                      title="البداية من هنا"
                      body="ستظهر تحديثات المهام هنا عند بدء العمل."
                    />
                  )}
                  <button
                    className="activity-link"
                    onClick={() => changePage("tasks")}
                  >
                    الانتقال إلى المهام
                    <ArrowUpLeft size={16} />
                  </button>
                </div>
              </section>
            </>
          )}
          {page === "employees" && (
            <>
              <div className="mini-summary">
                <span>
                  <Users size={18} />
                  <strong>{num(activeEmployees.length)}</strong> موظف في الفريق
                </span>
                <span>
                  <BriefcaseBusiness size={18} />
                  <strong>
                    {num(
                      new Set(activeEmployees.map((e) => e.profession)).size,
                    )}
                  </strong>{" "}
                  تخصصات
                </span>
                <span>
                  <Clock3 size={18} />
                  <strong>
                    {num(
                      activeEmployees.reduce((s, e) => s + e.daily_hours, 0),
                    )}
                  </strong>{" "}
                  ساعة مطلوبة يوميًا
                </span>
              </div>
              <section className="panel">
                <div className="toolbar">
                  <h2 className="employee-list-title">قائمة الموظفين</h2>
                  <SearchInput
                    value={search}
                    onChange={setSearch}
                    placeholder="ابحث عن موظف أو تخصص…"
                  />
                </div>
                {filteredEmployees.length ? (
                  <div className="table-wrap">
                    <table className="employees-table">
                      <thead>
                        <tr>
                          <th>الموظف</th>
                          <th>المهنة</th>
                          <th>رقم الهاتف</th>
                          <th>الساعات اليومية</th>
                          <th>المهام المفتوحة</th>
                          <th>الإجراءات</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredEmployees.map((e, i) => (
                          <tr key={e.id}>
                            <td>
                              <button
                                className="person-cell"
                                onClick={() =>
                                  setModal({
                                    type: "employee-detail",
                                    employee: e,
                                  })
                                }
                              >
                                <Avatar name={e.name} index={i} />
                                <span>
                                  <strong>{e.name}</strong>
                                  <small>
                                    انضم في {dateLabel(e.joined_on)}
                                  </small>
                                </span>
                              </button>
                            </td>
                            <td>{e.profession}</td>
                            <td dir="ltr">{e.phone || "—"}</td>
                            <td>{num(e.daily_hours)} ساعات</td>
                            <td>
                              <span className="count-badge">
                                {num(
                                  data.tasks.filter(
                                    (t) =>
                                      t.employee_id === e.id &&
                                      t.status !== "done",
                                  ).length,
                                )}
                              </span>
                            </td>
                            <td>
                              <div className="row-actions">
                                <button
                                  aria-label={`عرض ${e.name}`}
                                  title="عرض التفاصيل"
                                  className="icon-button"
                                  onClick={() =>
                                    setModal({
                                      type: "employee-detail",
                                      employee: e,
                                    })
                                  }
                                >
                                  <Eye size={17} />
                                </button>
                                {data.profile.role === "owner" && (
                                  <button
                                    aria-label={`تعديل ${e.name}`}
                                    title="تعديل"
                                    className="icon-button"
                                    onClick={() =>
                                      setModal({
                                        type: "employee",
                                        employee: e,
                                      })
                                    }
                                  >
                                    <Pencil size={16} />
                                  </button>
                                )}
                                {!e.archived_at && (
                                  <button
                                    aria-label={`حذف ${e.name}`}
                                    title="حذف الموظف"
                                    className="icon-button danger"
                                    onClick={() =>
                                      setModal({ type: "delete", employee: e })
                                    }
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty
                    icon={Users}
                    title={
                      search ? "لا توجد نتائج مطابقة" : "فريقك يبدأ بشخص واحد"
                    }
                    body={
                      search
                        ? "جرّب البحث باسم أو تخصص آخر."
                        : "ستظهر بيانات الموظفين هنا."
                    }
                  />
                )}
                <div className="table-footer">
                  عرض {num(filteredEmployees.length)} موظف{" "}
                  <span>حذف الموظف يزيل سجلاته المرتبطة نهائيًا</span>
                </div>
              </section>
            </>
          )}
          {page === "tasks" && (
            <>
              <div className="toolbar standalone">
                <div className="toolbar-group">
                  <SearchInput
                    value={search}
                    onChange={setSearch}
                    placeholder="ابحث عن مهمة…"
                  />
                  <select
                    aria-label="تصفية مهام الموظف"
                    value={taskFilter}
                    onChange={(e) => setTaskFilter(e.target.value)}
                  >
                    <option value="all">جميع الموظفين</option>
                    {activeEmployees.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="segmented compact">
                  <button
                    aria-label="عرض اللوحة"
                    className={taskView === "board" ? "active" : ""}
                    onClick={() => setTaskView("board")}
                  >
                    <LayoutGrid size={18} />
                  </button>
                  <button
                    aria-label="عرض القائمة"
                    className={taskView === "list" ? "active" : ""}
                    onClick={() => setTaskView("list")}
                  >
                    <List size={18} />
                  </button>
                </div>
              </div>
              {taskView === "board" ? (
                <div className="kanban">
                  {(["todo", "in_progress", "done"] as TaskStatus[]).map(
                    (status) => (
                      <section
                        className={`kanban-column ${status}`}
                        key={status}
                      >
                        <div className="kanban-heading">
                          <h2>
                            <i />
                            {statusNames[status]}
                            <span>
                              {num(
                                filteredTasks.filter((t) => t.status === status)
                                  .length,
                              )}
                            </span>
                          </h2>
                          <button
                            className="icon-button"
                            aria-label="إضافة مهمة"
                            onClick={() => setModal({ type: "task" })}
                          >
                            <Plus size={18} />
                          </button>
                        </div>
                        <div className="kanban-cards">
                          {filteredTasks
                            .filter((t) => t.status === status)
                            .map((task) => (
                              <TaskCard
                                key={task.id}
                                task={task}
                                employee={data.employees.find(
                                  (e) => e.id === task.employee_id,
                                )}
                                busy={busy}
                                open={() =>
                                  setModal({ type: "task-detail", task })
                                }
                                update={(s) => void updateStatus(task, s)}
                                remove={() =>
                                  setModal({ type: "delete-task", task })
                                }
                              />
                            ))}
                          {!filteredTasks.some((t) => t.status === status) && (
                            <div className="kanban-empty">
                              <Circle size={22} />
                              <p>لا توجد مهام {statusNames[status]} بعد</p>
                            </div>
                          )}
                        </div>
                      </section>
                    ),
                  )}
                </div>
              ) : (
                <div className="panel table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>المهمة</th>
                        <th>الموظف</th>
                        <th>الأولوية</th>
                        <th>الموعد</th>
                        <th>الحالة</th>
                        <th>الإجراءات</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTasks.map((t) => (
                        <tr key={t.id}>
                          <td>
                            <button
                              className="text-button"
                              onClick={() =>
                                setModal({ type: "task-detail", task: t })
                              }
                            >
                              {t.title}
                            </button>
                          </td>
                          <td>
                            {
                              data.employees.find((e) => e.id === t.employee_id)
                                ?.name
                            }
                          </td>
                          <td>
                            <span className={`priority ${t.priority}`}>
                              {priorityNames[t.priority]}
                            </span>
                          </td>
                          <td>
                            {t.due_date ? dateLabel(t.due_date) : "بدون موعد"}
                          </td>
                          <td>
                            <select
                              aria-label={`حالة ${t.title}`}
                              value={t.status}
                              disabled={busy}
                              onChange={(e) =>
                                void updateStatus(
                                  t,
                                  e.target.value as TaskStatus,
                                )
                              }
                            >
                              {Object.entries(statusNames).map(([s, n]) => (
                                <option value={s} key={s}>
                                  {n}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <button
                              className="icon-button danger"
                              disabled={busy}
                              aria-label={`حذف المهمة ${t.title}`}
                              title="حذف المهمة"
                              onClick={() =>
                                setModal({ type: "delete-task", task: t })
                              }
                            >
                              <Trash2 size={18} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!filteredTasks.length && (
                    <Empty
                      title="لا توجد مهام"
                      body="أضف مهمة جديدة أو غيّر عوامل التصفية."
                    />
                  )}
                </div>
              )}
            </>
          )}
          {page === "reports" && (
            <>
              <div className="toolbar standalone">
                <div className="toolbar-group">
                  <SearchInput
                    value={search}
                    onChange={setSearch}
                    placeholder="ابحث في التقارير…"
                  />
                  <select
                    aria-label="موظف التقرير"
                    value={reportEmployee}
                    onChange={(e) => setReportEmployee(e.target.value)}
                  >
                    <option value="all">جميع الموظفين</option>
                    {data.employees.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </select>
                </div>
                <MonthPicker
                  label="شهر التقارير"
                  value={month}
                  onChange={setMonth}
                />
              </div>
              <div className="reports-heading">
                <span>{num(filteredReports.length)} تقارير في هذه الفترة</span>
                <span>تُرسل من تطبيق الدسكتوب عند انتهاء الدوام</span>
              </div>
              {filteredReports.length ? (
                <div className="reports-grid">
                  {filteredReports.map((report, i) => {
                    const e = data.employees.find(
                      (e) => e.id === report.employee_id,
                    );
                    return (
                      <article className="panel report-card" key={report.id}>
                        <div className="report-top">
                          <div className="person-cell">
                            <Avatar name={e?.name || "موظف"} index={i} />
                            <span>
                              <strong>{e?.name}</strong>
                              <small>{e?.profession}</small>
                            </span>
                          </div>
                          <span className="report-icon">
                            <FileText size={19} />
                          </span>
                        </div>
                        <span className="report-date">
                          <CalendarDays size={14} />
                          {dateLabel(report.report_date)}
                        </span>
                        <p>{report.summary}</p>
                        <div className="report-time">
                          <span>
                            <Clock3 size={16} />
                            الدوام{" "}
                            <strong>
                              {num(hours(report.attendance_seconds))} س
                            </strong>
                          </span>
                          <span>
                            <Timer size={16} />
                            العمل{" "}
                            <strong>
                              {num(hours(report.active_seconds))} س
                            </strong>
                          </span>
                        </div>
                        <button
                          className="text-button"
                          onClick={() => setModal({ type: "report", report })}
                        >
                          قراءة التقرير كاملًا
                          <ArrowUpLeft size={15} />
                        </button>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="panel">
                  <Empty
                    icon={FileText}
                    title="لا توجد تقارير في هذه الفترة"
                    body="ستظهر تقارير الفريق هنا فور إرسالها من تطبيق الدسكتوب، أو اختر شهرًا آخر."
                  />
                </div>
              )}
            </>
          )}
          {page === "settings" && data.profile.role === "owner" && (
            <SettingsPanel
              data={data}
              demo={demo}
              busy={busy}
              team={team}
              setTeam={setTeam}
              api={api}
              save={(settings, token) =>
                void mutate(async () => {
                  if (demo) {
                    setData((d) =>
                      d
                        ? { ...d, settings: { ...d.settings, ...settings } }
                        : d,
                    );
                    notify("تم حفظ إعدادات المعاينة؛ لم يُحفظ أي توكن.");
                  } else {
                    await api("settings", "PATCH", {
                      ...settings,
                      bot_token: token || undefined,
                    });
                    await reload();
                    notify("تم حفظ الإعدادات");
                  }
                })
              }
              notify={notify}
              createAccount={(employee) =>
                setModal({ type: "account", employee })
              }
            />
          )}
          <footer className="page-footer">
            <span>
              المصطفى <i /> مساحة العمل التي تجمع فريقك
            </span>
            <span>
              <ShieldCheck size={13} />{" "}
              {demo ? "بيانات تجريبية" : "مساحة خاصة وآمنة"}
            </span>
          </footer>
        </main>
      </div>
      {toast && (
        <div className={`toast ${toast.error ? "error" : ""}`} role="status">
          {toast.error ? <CircleHelp size={18} /> : <CircleCheck size={18} />}
          <span>{toast.text}</span>
          <button aria-label="إغلاق التنبيه" onClick={() => setToast(null)}>
            <X size={16} />
          </button>
        </div>
      )}
      <dialog
        ref={dialog}
        className="modal"
        onCancel={() => setModal(null)}
        onClick={(e) => {
          if (e.target === dialog.current) setModal(null);
        }}
        aria-labelledby="modal-title"
      >
        <div className="modal-inner">
          <button
            className="modal-close icon-button"
            aria-label="إغلاق"
            onClick={() => setModal(null)}
          >
            <X size={20} />
          </button>
          {modal?.type === "employee" && (
            <>
              <span className="modal-symbol sage">
                <Users size={24} />
              </span>
              <h2 id="modal-title">
                {modal.employee
                  ? "تعديل بيانات الموظف"
                  : "شخص جديد، إضافة للفريق"}
              </h2>
              <p className="modal-description">
                أضف المعلومات الأساسية وحدد ساعات العمل المطلوبة.
              </p>
              <form onSubmit={saveEmployee}>
                <div className="form-grid">
                  <label>
                    الاسم الكامل
                    <input
                      autoFocus
                      name="name"
                      minLength={2}
                      maxLength={100}
                      defaultValue={modal.employee?.name}
                      placeholder="مثال: أحمد علي"
                      required
                    />
                  </label>
                  <label>
                    المهنة / الدور
                    <input
                      name="profession"
                      minLength={2}
                      maxLength={100}
                      defaultValue={modal.employee?.profession}
                      placeholder="مثال: مصمم واجهات"
                      required
                    />
                  </label>
                  <label>
                    رقم الهاتف
                    <input
                      name="phone"
                      dir="ltr"
                      maxLength={30}
                      defaultValue={modal.employee?.phone}
                      placeholder="+964 7XX XXX XXXX"
                    />
                  </label>
                  <label>
                    معرّف تلكرام
                    <input
                      name="telegram_id"
                      dir="ltr"
                      pattern="-?[0-9]*"
                      maxLength={30}
                      defaultValue={modal.employee?.telegram_id}
                      placeholder="Telegram ID"
                    />
                  </label>
                  <label>
                    ساعات العمل اليومية
                    <input
                      name="daily_hours"
                      type="number"
                      min="0.5"
                      max="24"
                      step="0.5"
                      defaultValue={modal.employee?.daily_hours ?? 8}
                      required
                    />
                  </label>
                  <label>
                    تاريخ الانضمام
                    <input
                      name="joined_on"
                      type="date"
                      defaultValue={
                        modal.employee?.joined_on || todayInBaghdad()
                      }
                      required
                    />
                  </label>
                </div>
                <div className="form-note">
                  <CircleHelp size={16} /> يُستخدم معرّف تلكرام الرقمي لإرسال
                  إشعارات المهام.
                </div>
                <div className="modal-actions">
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => setModal(null)}
                  >
                    إلغاء
                  </button>
                  <button className="button primary" disabled={busy}>
                    {busy
                      ? "جارٍ الحفظ…"
                      : modal.employee
                        ? "حفظ التعديلات"
                        : "إضافة الموظف"}
                    <Check size={16} />
                  </button>
                </div>
              </form>
            </>
          )}
          {modal?.type === "task" && (
            <>
              <span className="modal-symbol sage">
                <Columns3 size={24} />
              </span>
              <h2 id="modal-title">مهمة جديدة، خطوة للأمام</h2>
              <p className="modal-description">
                حدد المطلوب واختر الشخص المناسب لإنجازه.
              </p>
              {!activeEmployees.length ? (
                <Empty
                  icon={Users}
                  title="أضف موظفًا أولًا"
                  body="تحتاج المهمة إلى موظف مسؤول عن تنفيذها."
                  action={
                    <button
                      className="button primary"
                      onClick={() => setModal({ type: "employee" })}
                    >
                      إضافة موظف
                    </button>
                  }
                />
              ) : (
                <form onSubmit={saveTask}>
                  <label>
                    عنوان المهمة
                    <input
                      autoFocus
                      name="title"
                      minLength={3}
                      maxLength={200}
                      placeholder="ما الذي نريد إنجازه؟"
                      required
                    />
                  </label>
                  <label>
                    التفاصيل
                    <textarea
                      name="description"
                      rows={3}
                      maxLength={5000}
                      placeholder="أضف تفاصيل تساعد الموظف على البدء…"
                    />
                  </label>
                  <label>
                    إسناد إلى
                    <select name="employee_id" required>
                      <option value="">اختر موظفًا</option>
                      {activeEmployees.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.name} — {e.profession}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="form-grid">
                    <label>
                      الأولوية
                      <select name="priority" defaultValue="medium">
                        <option value="low">منخفضة</option>
                        <option value="medium">متوسطة</option>
                        <option value="high">عالية</option>
                      </select>
                    </label>
                    <label>
                      موعد التسليم <small>اختياري</small>
                      <input name="due_date" type="date" />
                    </label>
                  </div>
                  <div className="form-note">
                    <Send size={16} />
                    {demo
                      ? "هذه مهمة تجريبية، ولن يتم إرسال إشعار."
                      : "يُرسل إشعار للموظف إذا كانت إعدادات تلكرام مكتملة."}
                  </div>
                  <div className="modal-actions">
                    <button
                      className="button secondary"
                      type="button"
                      onClick={() => setModal(null)}
                    >
                      إلغاء
                    </button>
                    <button className="button primary" disabled={busy}>
                      {busy ? "جارٍ الإسناد…" : "إسناد المهمة"}
                      <ArrowUpLeft size={17} />
                    </button>
                  </div>
                </form>
              )}
            </>
          )}
          {modal?.type === "delete" && (
            <>
              <span className="modal-symbol peach">
                <Trash2 size={24} />
              </span>
              <h2 id="modal-title">حذف {modal.employee.name} نهائيًا؟</h2>
              <p className="modal-description">
                سيُحذف الموظف وحساب دخوله ومهامه وسجلات دوامه وتقاريره وطلبات
                المراجعة المرتبطة به نهائيًا. لا يمكن التراجع عن هذا الإجراء.
              </p>
              <div className="modal-actions">
                <button
                  className="button secondary"
                  onClick={() => setModal(null)}
                >
                  إلغاء
                </button>
                <button
                  className="button danger-button"
                  disabled={busy}
                  onClick={() => deleteEmployee(modal.employee)}
                >
                  حذف نهائي
                </button>
              </div>
            </>
          )}
          {modal?.type === "delete-task" && (
            <>
              <span className="modal-symbol rose">
                <Trash2 size={24} />
              </span>
              <h2 id="modal-title">حذف المهمة نهائيًا؟</h2>
              <p className="delete-task-title">{modal.task.title}</p>
              <p className="modal-description">
                سيُحذف سجل نشاط هذه المهمة وطلبات المراجعة المرتبطة بها أيضًا.
                لا يمكن التراجع عن الحذف.
              </p>
              <div className="modal-actions">
                <button
                  className="button secondary"
                  disabled={busy}
                  autoFocus
                  onClick={() => setModal(null)}
                >
                  إلغاء
                </button>
                <button
                  className="button danger-button"
                  disabled={busy}
                  onClick={() => deleteTask(modal.task)}
                >
                  <Trash2 size={17} />
                  {busy ? "جارٍ الحذف…" : "حذف المهمة نهائيًا"}
                </button>
              </div>
            </>
          )}
          {modal?.type === "employee-detail" && (
            <>
              <Avatar name={modal.employee.name} />
              <h2 id="modal-title">{modal.employee.name}</h2>
              <p className="modal-description">
                {modal.employee.profession} · {num(modal.employee.daily_hours)}{" "}
                ساعات يوميًا
              </p>
              <div className="detail-stats">
                {(() => {
                  const m = employeeMetrics(data, modal.employee, month);
                  return (
                    <>
                      <div>
                        <span>ساعات الدوام</span>
                        <strong>{num(hours(m.attendance))}</strong>
                      </div>
                      <div>
                        <span>وقت العمل</span>
                        <strong>{num(hours(m.active))}</strong>
                      </div>
                      <div>
                        <span>نسبة الدوام</span>
                        <strong>{num(m.percent)}٪</strong>
                      </div>
                    </>
                  );
                })()}
              </div>
              <h3>المهام المنجزة</h3>
              <div className="detail-list">
                {data.tasks
                  .filter(
                    (t) =>
                      t.employee_id === modal.employee.id &&
                      t.status === "done",
                  )
                  .map((t) => (
                    <div key={t.id}>
                      <CircleCheck size={18} />
                      <span>{t.title}</span>
                      <small>
                        {t.completed_at && dateLabel(t.completed_at)}
                      </small>
                    </div>
                  ))}
                {!data.tasks.some(
                  (t) =>
                    t.employee_id === modal.employee.id && t.status === "done",
                ) && <p className="muted">لا توجد مهام منجزة بعد.</p>}
              </div>
              <h3>التقارير اليومية</h3>
              <div className="detail-list">
                {data.reports
                  .filter((r) => r.employee_id === modal.employee.id)
                  .map((r) => (
                    <button
                      key={r.id}
                      onClick={() => setModal({ type: "report", report: r })}
                    >
                      <FileText size={17} />
                      {dateLabel(r.report_date)}
                      <ChevronLeft size={16} />
                    </button>
                  ))}
                {!data.reports.some(
                  (r) => r.employee_id === modal.employee.id,
                ) && <p className="muted">لا توجد تقارير مرسلة بعد.</p>}
              </div>
            </>
          )}
          {modal?.type === "report" && (
            <>
              <span className="modal-symbol sage">
                <FileText size={24} />
              </span>
              <h2 id="modal-title">
                تقرير{" "}
                {
                  data.employees.find((e) => e.id === modal.report.employee_id)
                    ?.name
                }
              </h2>
              <p className="modal-description">
                {dateLabel(modal.report.report_date)}
              </p>
              <div className="report-full">{modal.report.summary}</div>
              <div className="detail-stats">
                <div>
                  <span>ساعات الدوام</span>
                  <strong>{num(hours(modal.report.attendance_seconds))}</strong>
                </div>
                <div>
                  <span>وقت العمل الفعلي</span>
                  <strong>{num(hours(modal.report.active_seconds))}</strong>
                </div>
              </div>
            </>
          )}
          {modal?.type === "task-detail" && (
            <>
              <span className={`priority ${modal.task.priority}`}>
                أولوية {priorityNames[modal.task.priority]}
              </span>
              <h2 id="modal-title">{modal.task.title}</h2>
              <p className="modal-description">
                مسؤول التنفيذ:{" "}
                {
                  data.employees.find((e) => e.id === modal.task.employee_id)
                    ?.name
                }
              </p>
              <div className="report-full">
                {modal.task.description || "لا توجد تفاصيل إضافية."}
              </div>
              <div className="task-detail-meta">
                <span>
                  الحالة:{" "}
                  {
                    statusNames[
                      data.tasks.find((t) => t.id === modal.task.id)?.status ||
                        modal.task.status
                    ]
                  }
                </span>
                <span>
                  الموعد:{" "}
                  {modal.task.due_date
                    ? dateLabel(modal.task.due_date)
                    : "غير محدد"}
                </span>
              </div>
              <label>
                تغيير الحالة
                <select
                  disabled={busy}
                  value={
                    data.tasks.find((t) => t.id === modal.task.id)?.status ||
                    modal.task.status
                  }
                  onChange={(e) =>
                    void updateStatus(
                      data.tasks.find((t) => t.id === modal.task.id)!,
                      e.target.value as TaskStatus,
                    )
                  }
                >
                  {Object.entries(statusNames).map(([s, n]) => (
                    <option key={s} value={s}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <h3>طلب مراجعة</h3>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void mutate(async () => {
                    if (demo) {
                      setData((d) =>
                        d
                          ? {
                              ...d,
                              activities: [
                                {
                                  id: crypto.randomUUID(),
                                  task_id: modal.task.id,
                                  actor_name: d.profile.name,
                                  action: `طلب مراجعة من ${d.employees.find((employee) => employee.id === f.get("reviewer_id"))?.name}`,
                                  created_at: new Date().toISOString(),
                                },
                                ...d.activities,
                              ],
                            }
                          : d,
                      );
                    } else {
                      const result = await api("reviews", "POST", {
                        task_id: modal.task.id,
                        reviewer_id: String(f.get("reviewer_id")),
                        note: String(f.get("note")),
                      });
                      await reload();
                      if (result.notification === "failed") {
                        notify(
                          "تم حفظ طلب المراجعة، لكن تعذّر إرسال الإشعار.",
                          true,
                        );
                        return;
                      }
                    }
                    notify(
                      demo
                        ? "تم تسجيل طلب المراجعة في المعاينة"
                        : "تم تسجيل طلب المراجعة",
                    );
                  });
                }}
              >
                <label>
                  المراجع
                  <select name="reviewer_id" required>
                    <option value="">اختر موظفًا</option>
                    {activeEmployees
                      .filter((e) => e.id !== modal.task.employee_id)
                      .map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  ملاحظة
                  <textarea name="note" maxLength={2000} rows={2} />
                </label>
                <button
                  className="button primary"
                  disabled={busy || activeEmployees.length < 2}
                >
                  طلب مراجعة
                  <Send size={15} />
                </button>
              </form>
              <div className="task-detail-actions">
                <button
                  className="button delete-task-button"
                  disabled={busy}
                  onClick={() =>
                    setModal({ type: "delete-task", task: modal.task })
                  }
                >
                  <Trash2 size={17} />
                  حذف المهمة
                </button>
              </div>
            </>
          )}
          {modal?.type === "account" && (
            <>
              <span className="modal-symbol sage">
                <ShieldCheck size={24} />
              </span>
              <h2 id="modal-title">حساب {modal.employee.name}</h2>
              <p className="modal-description">
                حساب الموظف للدسكتوب، وحساب المدير للدسكتوب ولوحة الويب.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void mutate(async () => {
                    if (demo)
                      throw new Error(
                        "إنشاء حسابات الدخول متاح في النسخة المتصلة فقط.",
                      );
                    await api("team", "POST", {
                      employee_id: modal.employee.id,
                      email: String(f.get("email")),
                      password: String(f.get("password")),
                      role: String(f.get("role")),
                    });
                    await reload();
                    setTeam(await api("team"));
                    notify("تم إنشاء حساب الدخول");
                  });
                }}
              >
                <label>
                  البريد الإلكتروني
                  <input
                    type="email"
                    name="email"
                    dir="ltr"
                    required
                    autoComplete="off"
                  />
                </label>
                <label>
                  كلمة مرور أولية
                  <input
                    type="password"
                    name="password"
                    dir="ltr"
                    minLength={12}
                    maxLength={72}
                    required
                    autoComplete="new-password"
                  />
                </label>
                <label>
                  الصلاحية
                  <select name="role">
                    <option value="employee">موظف — الدسكتوب فقط</option>
                    <option value="manager">مدير — الويب والدسكتوب</option>
                  </select>
                </label>
                <div className="modal-actions">
                  <button className="button primary" disabled={busy || demo}>
                    إنشاء الحساب
                  </button>
                </div>
              </form>
            </>
          )}
        </div>
      </dialog>
    </div>
  );
}

function MonthPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [year, mo] = value.split("-").map(Number);
  const move = (offset: number) => {
    const date = new Date(Date.UTC(year, mo - 1 + offset, 1));
    onChange(date.toISOString().slice(0, 7));
  };
  return (
    <div className="month-control">
      <button
        className="icon-button"
        type="button"
        aria-label={`${label}: الشهر السابق`}
        onClick={() => move(-1)}
      >
        <ChevronRight size={14} />
      </button>
      <span className="arabic-month" aria-label={label}>
        {new Intl.DateTimeFormat("ar-IQ-u-nu-latn", {
          month: "long",
          year: "numeric",
        }).format(new Date(`${value}-15T12:00:00Z`))}
      </span>
      <button
        className="icon-button"
        type="button"
        aria-label={`${label}: الشهر التالي`}
        onClick={() => move(1)}
      >
        <ChevronLeft size={14} />
      </button>
    </div>
  );
}
function ArrowLeftIcon() {
  return <ArrowUpLeft size={17} />;
}
function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (s: string) => void;
  placeholder: string;
}) {
  return (
    <div className="search-field">
      <Search size={17} />
      <input
        aria-label={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      {value && (
        <button aria-label="مسح البحث" onClick={() => onChange("")}>
          <X size={14} />
        </button>
      )}
    </div>
  );
}
function Stat({
  title,
  value,
  unit,
  icon: Icon,
  detail,
  featured = false,
}: {
  title: string;
  value: string;
  unit: string;
  icon: LucideIcon;
  detail: string;
  featured?: boolean;
}) {
  return (
    <article className={`stat-card ${featured ? "featured" : ""}`}>
      <div className="stat-top">
        <span>{title}</span>
        <span className="stat-icon">
          <Icon size={20} />
        </span>
      </div>
      <div className="stat-value">
        {value}
        <small>{unit}</small>
      </div>
      <p>
        {featured && <i />}
        {detail}
      </p>
      {featured && <div className="stat-shape" />}
    </article>
  );
}
function WorkChart({ data, month }: { data: AppData; month: string }) {
  const today = todayInBaghdad();
  const end =
    month === today.slice(0, 7)
      ? Number(today.slice(-2))
      : new Date(
          Number(month.slice(0, 4)),
          Number(month.slice(5, 7)),
          0,
        ).getDate();
  const days = Array.from({ length: 7 }, (_, i) => end - 6 + i);
  const rows = days.map((day) => {
    const date = `${month}-${String(day).padStart(2, "0")}`;
    const logs = data.attendance.filter((a) => a.work_date === date);
    return {
      day,
      date,
      total: hours(logs.reduce((s, a) => s + a.attendance_seconds, 0)),
      active: hours(logs.reduce((s, a) => s + a.active_seconds, 0)),
    };
  });
  const max = Math.max(8, ...rows.map((r) => r.total));
  return (
    <div
      className="chart-area"
      role="img"
      aria-label="مقارنة ساعات الدوام ووقت العمل الفعلي خلال سبعة أيام"
    >
      <div className="chart-scale">
        {[1, 0.75, 0.5, 0.25, 0].map((n) => (
          <span key={n}>{num(Math.round(max * n))}</span>
        ))}
      </div>
      <div className="chart-plot">
        <div className="chart-lines">
          {[0, 1, 2, 3, 4].map((n) => (
            <i key={n} />
          ))}
        </div>
        <div className="chart-bars">
          {rows.map((r, i) => (
            <div className="chart-day" key={i}>
              <div
                className="bar-group"
                title={
                  r.day > 0
                    ? `${dateLabel(r.date)}: الدوام ${r.total} ساعة، العمل ${r.active} ساعة`
                    : "خارج الشهر"
                }
              >
                <div
                  className="bar attendance"
                  style={{ height: `${(r.total / max) * 100}%` }}
                />
                <div
                  className="bar active"
                  style={{ height: `${(r.active / max) * 100}%` }}
                />
              </div>
              <span>
                {r.day > 0
                  ? new Intl.DateTimeFormat("ar-IQ-u-nu-latn", {
                      weekday: "short",
                    }).format(new Date(`${r.date}T12:00:00Z`))
                  : "—"}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
function TaskCard({
  task,
  employee,
  busy,
  open,
  update,
  remove,
}: {
  task: Task;
  employee?: Employee;
  busy: boolean;
  open: () => void;
  update: (s: TaskStatus) => void;
  remove: () => void;
}) {
  return (
    <article className="task-card">
      <div className="task-card-top">
        <span className={`priority ${task.priority}`}>
          <i />
          {priorityNames[task.priority]}
        </span>
        <div className="task-card-actions">
          <button
            className="icon-button"
            aria-label={`تفاصيل ${task.title}`}
            onClick={open}
          >
            <MoreHorizontal size={18} />
          </button>
          <button
            className="icon-button danger"
            aria-label={`حذف المهمة ${task.title}`}
            title="حذف المهمة"
            disabled={busy}
            onClick={remove}
          >
            <Trash2 size={17} />
          </button>
        </div>
      </div>
      <button className="task-title" onClick={open}>
        {task.title}
      </button>
      <p>{task.description || "كل إنجاز يبدأ بخطوة."}</p>
      {task.due_date && (
        <span
          className={`task-due ${task.due_date < todayInBaghdad() && task.status !== "done" ? "overdue" : ""}`}
        >
          <CalendarDays size={13} />
          {dateLabel(task.due_date)}
          {task.due_date < todayInBaghdad() && task.status !== "done"
            ? " · متأخرة"
            : ""}
        </span>
      )}
      <div className="task-card-bottom">
        <span>
          <Avatar name={employee?.name || "موظف"} small />
          {employee?.name}
        </span>
        <select
          aria-label={`حالة ${task.title}`}
          value={task.status}
          disabled={busy}
          onChange={(e) => update(e.target.value as TaskStatus)}
        >
          {Object.entries(statusNames).map(([s, n]) => (
            <option value={s} key={s}>
              {n}
            </option>
          ))}
        </select>
      </div>
    </article>
  );
}
function SettingsPanel({
  data,
  demo,
  busy,
  team,
  setTeam,
  api,
  save,
  notify,
  createAccount,
}: {
  data: AppData;
  demo: boolean;
  busy: boolean;
  team: Profile[];
  setTeam: (p: Profile[]) => void;
  api: (path: string, method?: string, body?: unknown) => Promise<any>;
  save: (s: AppData["settings"], token: string) => void;
  notify: (s: string, error?: boolean) => void;
  createAccount: (e: Employee) => void;
}) {
  const [days, setDays] = useState(data.settings.work_days);
  const [enabled, setEnabled] = useState(data.settings.telegram_enabled);
  const [token, setToken] = useState("");
  const [name, setName] = useState(data.settings.organization_name);
  const [roleBusy, setRoleBusy] = useState(false);
  return (
    <div className="settings-layout">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save(
            {
              organization_name: name,
              work_days: days,
              telegram_enabled: enabled,
            },
            token,
          );
          setToken("");
        }}
      >
        <section className="panel settings-panel">
          <div className="settings-title">
            <span className="modal-symbol sage">
              <BriefcaseBusiness size={21} />
            </span>
            <div>
              <h2>إعدادات مساحة العمل</h2>
              <p>التفاصيل الأساسية التي يراها فريقك.</p>
            </div>
          </div>
          <label>
            اسم المؤسسة
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              minLength={2}
              maxLength={100}
              required
            />
          </label>
          <label>أيام العمل الأسبوعية</label>
          <div className="weekdays">
            {[
              "الأحد",
              "الإثنين",
              "الثلاثاء",
              "الأربعاء",
              "الخميس",
              "الجمعة",
              "السبت",
            ].map((day, i) => (
              <button
                type="button"
                aria-pressed={days.includes(i)}
                key={day}
                className={days.includes(i) ? "active" : ""}
                onClick={() =>
                  setDays(
                    days.includes(i)
                      ? days.filter((d) => d !== i)
                      : [...days, i],
                  )
                }
              >
                {day}
                {days.includes(i) && <Check size={13} />}
              </button>
            ))}
          </div>
          <p className="field-hint">
            تُحسب نسبة الدوام من أيام العمل منذ تاريخ الانضمام وحتى اليوم. لا
            تشمل الأيام المستقبلية.
          </p>
        </section>
        <section className="panel settings-panel">
          <div className="settings-title">
            <span className="modal-symbol blue">
              <Send size={21} />
            </span>
            <div>
              <h2>بوت تلكرام</h2>
              <p>تحديثات الفريق تصل في وقتها.</p>
            </div>
            <span
              className={`badge ${data.settings.bot_configured ? "success" : ""}`}
            >
              {data.settings.bot_configured ? "تم الربط" : "غير مرتبط"}
            </span>
          </div>
          <div className="switch-row">
            <div>
              <strong>إشعارات تلكرام</strong>
              <p>إسناد المهام وتغيير حالاتها وطلبات المراجعة.</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              aria-label="تفعيل إشعارات تلكرام"
              className={`switch ${enabled ? "on" : ""}`}
              onClick={() => setEnabled(!enabled)}
            >
              <span />
            </button>
          </div>
          <label>
            توكن البوت
            <input
              type="password"
              name="bot_token"
              dir="ltr"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoComplete="off"
              placeholder={
                data.settings.bot_configured
                  ? "اتركه فارغًا للاحتفاظ بالتوكن الحالي"
                  : "أدخل التوكن الذي حصلت عليه من BotFather"
              }
              disabled={demo || !data.settings.server_ready}
            />
          </label>
          <p className="field-hint">
            <LockKeyhole size={13} /> يُشفّر التوكن على الخادم ولا يظهر مرة أخرى
            بعد حفظه.
          </p>
          {!data.settings.server_ready && !demo && (
            <div className="alert">
              ربط البوت يحتاج استكمال إعداد مفاتيح الخادم. يمكنك حفظ بقية
              الإعدادات الآن.
            </div>
          )}
          {demo && (
            <div className="alert">
              إرسال الإشعارات وحفظ التوكن متاحان في النسخة المتصلة فقط.
            </div>
          )}
        </section>
        <div className="settings-save">
          <button className="button primary" disabled={busy || !days.length}>
            {busy ? "جارٍ الحفظ…" : "حفظ التغييرات"}
            <Check size={17} />
          </button>
        </div>
      </form>
      <aside>
        <section className="panel settings-panel">
          <div className="settings-title">
            <span className="modal-symbol lilac">
              <ShieldCheck size={21} />
            </span>
            <div>
              <h2>الحسابات والصلاحيات</h2>
              <p>الأشخاص الذين يمكنهم الدخول.</p>
            </div>
          </div>
          <div className="permission-note">
            <strong>المالك</strong>
            <p>إدارة كاملة للموظفين والإعدادات والحسابات.</p>
            <strong>المدير</strong>
            <p>إضافة الموظفين وحذفهم وإسناد المهام وعرض التقارير.</p>
          </div>
          {!demo &&
            team
              .filter((p) => p.id !== data.profile.id)
              .map((p) => (
                <div className="account-row" key={p.id}>
                  <span>{p.name}</span>
                  <select
                    disabled={roleBusy}
                    aria-label={`صلاحية ${p.name}`}
                    value={p.role}
                    onChange={async (e) => {
                      setRoleBusy(true);
                      try {
                        await api("team", "PATCH", {
                          id: p.id,
                          role: e.target.value,
                        });
                        setTeam(await api("team"));
                        notify("تم تحديث الصلاحية");
                      } catch (err) {
                        notify((err as Error).message, true);
                      } finally {
                        setRoleBusy(false);
                      }
                    }}
                  >
                    <option value="manager">مدير</option>
                    <option value="employee">موظف</option>
                  </select>
                </div>
              ))}
          <h3>إنشاء حساب دخول</h3>
          <p className="field-hint">اختر موظفًا لإعداد حسابه وصلاحيته.</p>
          {data.employees
            .filter((e) => !e.archived_at && !e.user_id)
            .map((e, i) => (
              <div className="account-row" key={e.id}>
                <div className="person-cell">
                  <Avatar name={e.name} small index={i} />
                  <strong>{e.name}</strong>
                </div>
                <button
                  type="button"
                  className="text-button"
                  disabled={!demo && !data.settings.server_ready}
                  onClick={() => createAccount(e)}
                >
                  إعداد
                  <ChevronLeft size={14} />
                </button>
              </div>
            ))}
          {!demo && !data.settings.server_ready && (
            <p className="field-hint">
              إنشاء الحسابات يحتاج مفتاح إدارة Supabase على الخادم.
            </p>
          )}
        </section>
        <div className="settings-footnote">
          <ShieldCheck size={19} />
          <p>
            صلاحيات الويب محصورة بالمالك والمدير. الموظفون يعملون عبر تطبيق
            الدسكتوب.
          </p>
        </div>
      </aside>
    </div>
  );
}
