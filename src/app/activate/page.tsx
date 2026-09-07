"use client";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { ShieldCheck } from "lucide-react";
import { ThemeToggle } from "@/components/theme-provider";
export default function Activate() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const params = new URLSearchParams(location.search);
    const hash = params.get("token_hash");
    const type = params.get("type");
    if (!hash || !["invite", "recovery"].includes(type || "")) {
      setError("رابط التفعيل غير صالح.");
      return;
    }
    void supabase?.auth
      .verifyOtp({ token_hash: hash, type: type as "invite" | "recovery" })
      .then(({ error }) => {
        history.replaceState(null, "", "/activate");
        if (error)
          setError(
            "انتهت صلاحية الرابط أو تم استخدامه. اطلب رابط تفعيل جديدًا.",
          );
        else setReady(true);
      });
  }, []);
  return (
    <main className="login-form" style={{ minHeight: "100vh" }}>
      <ThemeToggle className="login-theme-toggle" />
      <div className="login-form-inner">
        <span className="login-icon">
          <ShieldCheck size={28} />
        </span>
        <h2>مرحبًا بك في المصطفى</h2>
        <p>اختر كلمة مرور لحسابك لتبدأ إدارة مساحة العمل.</p>
        {error && <div className="alert error">{error}</div>}
        {ready ? (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const password = String(f.get("password"));
              if (password !== f.get("confirm")) {
                setError("كلمتا المرور غير متطابقتين.");
                return;
              }
              setBusy(true);
              setError("");
              const result = await supabase?.auth.updateUser({ password });
              if (result?.error) {
                setError(
                  "تعذّر حفظ كلمة المرور. استخدم من 6 إلى 12 خانة، أو اطلب رابط تفعيل جديدًا إذا انتهت صلاحية الرابط.",
                );
                setBusy(false);
              } else location.href = "/";
            }}
          >
            <label>
              كلمة المرور الجديدة
              <input
                name="password"
                type="password"
                dir="ltr"
                minLength={6}
                maxLength={12}
                aria-describedby="activation-password-hint"
                autoComplete="new-password"
                required
              />
            </label>
            <label>
              تأكيد كلمة المرور
              <input
                name="confirm"
                type="password"
                dir="ltr"
                minLength={6}
                maxLength={12}
                autoComplete="new-password"
                required
              />
            </label>
            <p id="activation-password-hint" className="field-hint">
              من 6 إلى 12 خانة، ويمكن استخدام أرقام فقط.
            </p>
            <button className="button primary full" disabled={busy}>
              {busy ? "جارٍ الحفظ…" : "حفظ كلمة المرور والدخول"}
            </button>
          </form>
        ) : (
          !error && <p>جارٍ التحقق من رابط التفعيل…</p>
        )}
        <a href="/" className="text-button" style={{ marginTop: 22 }}>
          العودة لتسجيل الدخول
        </a>
      </div>
    </main>
  );
}
