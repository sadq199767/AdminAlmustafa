"use client";
import { useEffect, useState, useCallback } from "react";
import {
  Power,
  PowerOff,
  LockKeyhole,
  ShieldCheck,
  LogOut,
  CircleAlert,
  ArrowLeft,
} from "lucide-react";
import { supabase, configured } from "@/lib/supabase";
import { ThemeToggle } from "@/components/theme-provider";

type SystemStatus = {
  system_suspended: boolean;
  system_suspend_reason: string;
};

export default function AdminControl() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    const { data } = await supabase!.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      setStatus(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/admin/control", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      if (!res.ok) {
        if (res.status === 401) {
          await supabase!.auth.signOut();
          setStatus(null);
          setDenied("");
        } else {
          setDenied(body.error || "تعذّر التحقق من الحساب.");
        }
        return;
      }
      setDenied("");
      setStatus(body);
      setReason(body.system_suspend_reason);
    } catch {
      setDenied("تعذّر الاتصال بخادم التحكم.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!configured) {
      setLoading(false);
      return;
    }
    void refresh();
    const onState = () => void refresh();
    const { data: sub } = supabase!.auth.onAuthStateChange(onState);
    return () => {
      sub.subscription.unsubscribe();
    };
  }, [refresh]);

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { error } = await supabase!.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw new Error("البريد الإلكتروني أو كلمة المرور غير صحيحة.");
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (suspend: boolean) => {
    setSaving(true);
    setError("");
    try {
      const { data } = await supabase!.auth.getSession();
      const res = await fetch("/api/admin/control", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${data.session!.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          system_suspended: suspend,
          system_suspend_reason: suspend ? reason.trim() : "",
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "تعذّر تحديث حالة النظام.");
      setStatus(body);
      setReason(body.system_suspend_reason);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const requestStop = () => {
    const confirmed = window.confirm(
      "سيتم إيقاف النظام بالكامل: برنامج الموظفين ولوحة التحكم معًا.\n" +
        "لن يقبل النظام تسجيل دوام أو تقارير أو مهام حتى يعاد تشغيله.\n\n" +
        "هل أنت متأكد؟",
    );
    if (confirmed) void toggle(true);
  };

  const signOut = async () => {
    await supabase!.auth.signOut();
    setStatus(null);
    setDenied("");
    setError("");
  };

  if (!configured)
    return (
      <div className="login-page" style={{ minHeight: "100vh" }}>
        <ThemeToggle className="login-theme-toggle" />
        <div className="admin-notice" style={{ margin: "2rem auto", maxWidth: 480 }}>
          <CircleAlert size={16} />
          أكمل إعداد الاتصال بـ Supabase أولًا لعرض لوحة التحكم.
        </div>
      </div>
    );

  if (loading)
    return (
      <div className="loading-screen">
        <div className="brand-symbol">م</div>
        <span className="spinner" />
        <p>نفحص حالة النظام…</p>
      </div>
    );

  if (!status)
    return (
      <div className="login-page">
        <ThemeToggle className="login-theme-toggle" />
        <div className="login-story">
          <div>
            <a className="brand" href="/">
              <span className="brand-symbol">م</span>
              <strong>
                منصة المالك
                <span>التحكم الكلي في النظام</span>
              </strong>
            </a>
            <span className="eyebrow">لوحة المالك</span>
            <h1>التحكم في حالة النظام.</h1>
            <p>
              حدد من يبدأ العمل ومتى يتوقف. هذه الصفحة مخصصة لحساب المالك فقط
              لإيقاف النظام بالكامل أو إعادة تشغيله في أي وقت.
            </p>
            <div className="login-preview">
              <span>
                <ShieldCheck />
                صلاحية المالك فقط
              </span>
              <span>
                <Power />
                إيقاف وإعادة تشغيل
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
            <h2>دخول المالك فقط</h2>
            <p>سجّل دخولك بحساب المالك للوصول إلى التحكم الكلي.</p>
            {(error || denied) && (
              <div className="alert error">{error || denied}</div>
            )}
            <form onSubmit={signIn}>
              <label>
                البريد الإلكتروني
                <input
                  type="email"
                  dir="ltr"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="username"
                  required
                />
              </label>
              <label>
                كلمة المرور
                <input
                  type="password"
                  dir="ltr"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </label>
              <button className="button primary full" disabled={busy}>
                {busy ? "جارٍ تسجيل الدخول…" : "دخول المالك"}
              </button>
            </form>
            <small className="login-note">
              <ShieldCheck size={15} /> غير متاح إلا لحساب المالك (owner)
            </small>
          </div>
        </main>
      </div>
    );

  const suspended = status.system_suspended;
  const reasonText = (reason || "").trim();

  return (
    <div className="admin-page">
      <header className="admin-topbar">
        <a className="brand" href="/">
          <span className="brand-symbol">م</span>
          <strong>
            المصطفى
            <span>تحكم المالك</span>
          </strong>
        </a>
        <div className="admin-topbar-actions">
          <span className={`admin-pill ${suspended ? "suspended" : "running"}`}>
            <i />
            {suspended ? "النظام موقوف" : "النظام يعمل"}
          </span>
          <span className="topbar-divider" />
          <ThemeToggle />
          <button
            className="icon-button"
            title="تسجيل الخروج"
            aria-label="تسجيل الخروج"
            onClick={() => void signOut()}
          >
            <LogOut size={17} />
          </button>
        </div>
      </header>

      <main className="admin-main">
        <div className="admin-hero">
          <span className="eyebrow">لوحة المالك</span>
          <h1>التحكم في حالة النظام</h1>
          <p>
            أوقف البرنامج ولوحة التحكم لحظيًا عند الحاجة، أو أعد تشغيل النظام
            بضغطة واحدة — وتبقى هذه الصفحة متاحة دائمًا.
          </p>
        </div>

        <section className="admin-card">
          <div className="admin-status">
            <span className={`admin-status-icon ${suspended ? "suspended" : "running"}`}>
              {suspended ? <PowerOff size={26} /> : <Power size={26} />}
            </span>
            <div>
              <h2>{suspended ? "النظام متوقف عن العمل" : "كل شيء يعمل الآن"}</h2>
              <p>
                {suspended
                  ? "برنامج الموظفين ولوحة التحكم متوقفان. برّد السبب للجميع ثم أعد التشغيل."
                  : "برنامج الموظفين ولوحة التحكم نشطان، ويمكن إيقافهما بالكامل عند الحاجة."}
              </p>
            </div>
          </div>

          {error && <div className="alert error">{error}</div>}

          <div className="admin-control">
            <label htmlFor="owner-reason">
              {suspended ? "سبب الإيقاف الحالي" : "سبب الإيقاف (اختياري)"}
            </label>
            <textarea
              id="owner-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={
                suspended
                  ? "سبب يطلع عليه الجميع عند فتح البرنامج…"
                  : "مثال: صيانة، توقف مؤقت لمتابعة تقارير…"
              }
            />
            {suspended ? (
              <button
                className={`button ${reasonText ? "primary" : "secondary"}`}
                disabled={saving}
                onClick={() => void toggle(false)}
              >
                {saving ? (
                  "جارٍ…"
                ) : (
                  <>
                    <Power size={17} /> إعادة تشغيل النظام
                  </>
                )}
              </button>
            ) : (
              <button
                className="button danger-button"
                disabled={saving}
                onClick={requestStop}
              >
                {saving ? (
                  "جارٍ…"
                ) : (
                  <>
                    <PowerOff size={17} /> إيقاف النظام بالكامل
                  </>
                )}
              </button>
            )}
          </div>
        </section>

        <div className="admin-notice">
          <CircleAlert size={17} />
          <p>
            عند الإيقاف يعرض البرنامج شاشة «النظام موقوف» مع السبب، ويُرَفَض تسجيل
            الدوام والتقارير والمهام حتى يعاد التشغيل من هذه الصفحة.
          </p>
        </div>

        <div className="admin-footer">
          <a className="text-button" href="/">
            العودة إلى لوحة التحكم <ArrowLeft size={16} />
          </a>
        </div>
      </main>
    </div>
  );
}