"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

const ThemeContext = createContext({ dark: false, toggle: () => {} });
const storageKey = "almustafa-theme";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const system = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => {
      let saved: string | null = null;
      try {
        saved = localStorage.getItem(storageKey);
      } catch {}
      const value = saved === "dark" || (saved !== "light" && system.matches);
      document.documentElement.dataset.theme = value ? "dark" : "light";
      setDark(value);
    };
    const storageChanged = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) sync();
    };
    sync();
    system.addEventListener("change", sync);
    window.addEventListener("storage", storageChanged);
    return () => {
      system.removeEventListener("change", sync);
      window.removeEventListener("storage", storageChanged);
    };
  }, []);

  const toggle = () => {
    const value = document.documentElement.dataset.theme !== "dark";
    document.documentElement.dataset.theme = value ? "dark" : "light";
    setDark(value);
    try {
      localStorage.setItem(storageKey, value ? "dark" : "light");
    } catch {}
  };

  return (
    <ThemeContext.Provider value={{ dark, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function ThemeToggle({ className = "" }: { className?: string }) {
  const { dark, toggle } = useContext(ThemeContext);
  return (
    <button
      type="button"
      className={`theme-toggle ${className}`}
      onClick={toggle}
      aria-label="الوضع المظلم"
      aria-pressed={dark}
      title={dark ? "تفعيل الوضع الفاتح" : "تفعيل الوضع المظلم"}
    >
      {dark ? <Sun size={19} /> : <Moon size={19} />}
      <span>الوضع المظلم</span>
    </button>
  );
}
