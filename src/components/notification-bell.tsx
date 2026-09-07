"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, CheckCheck, X } from "lucide-react";
import type { Activity, Task } from "@/lib/types";

export function NotificationBell({
  activities,
  tasks,
  accountKey,
  open,
  onOpenChange,
}: {
  activities: Activity[];
  tasks: Task[];
  accountKey: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const storageKey = `almustafa-notifications-read-${accountKey}`;
  const [readThrough, setReadThrough] = useState(Infinity);
  const [popup, setPopup] = useState<{
    activity: Activity;
    title: string;
    count: number;
  } | null>(null);
  const seen = useRef({ key: "", ids: new Set<string>(), latest: 0 });
  const container = useRef<HTMLDivElement>(null);
  const popupElement = useRef<HTMLElement>(null);

  const markRead = () => {
    const time = Math.max(
      Date.now(),
      ...activities.map((a) => Date.parse(a.created_at)),
    );
    setReadThrough(time);
    try {
      localStorage.setItem(storageKey, String(time));
    } catch {}
  };

  useEffect(() => {
    const latest = Math.max(
      0,
      ...activities.map((a) => Date.parse(a.created_at)),
    );
    if (seen.current.key !== storageKey) {
      let saved: string | null = null;
      try {
        saved = localStorage.getItem(storageKey);
      } catch {}
      const initialRead =
        saved !== null && Number.isFinite(Number(saved))
          ? Number(saved)
          : Math.max(Date.now(), latest);
      setReadThrough(initialRead);
      try {
        localStorage.setItem(storageKey, String(initialRead));
      } catch {}
      seen.current = {
        key: storageKey,
        ids: new Set(activities.map((a) => a.id)),
        latest,
      };
      setPopup(null);
      return;
    }
    // A refresh or an older item entering the limited feed is not a new notification.
    const fresh = activities.filter(
      (a) =>
        !seen.current.ids.has(a.id) &&
        Date.parse(a.created_at) >= seen.current.latest,
    );
    activities.forEach((a) => seen.current.ids.add(a.id));
    seen.current.latest = Math.max(seen.current.latest, latest);
    if (fresh.length) {
      const newest = fresh.reduce((a, b) =>
        a.created_at > b.created_at ? a : b,
      );
      setPopup({
        activity: newest,
        title:
          tasks.find((t) => t.id === newest.task_id)?.title || "تحديث المهمة",
        count: fresh.length,
      });
    }
  }, [activities, tasks, storageKey]);

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (
        event.key === storageKey &&
        event.newValue !== null &&
        Number.isFinite(Number(event.newValue))
      ) {
        setReadThrough(Number(event.newValue));
      }
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [storageKey]);

  useEffect(() => {
    if (!popup) return;
    popupElement.current?.showPopover();
    const timer = setTimeout(() => setPopup(null), 5000);
    return () => clearTimeout(timer);
  }, [popup]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node))
        onOpenChange(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open, onOpenChange]);

  const unread = activities.some((a) => Date.parse(a.created_at) > readThrough);
  return (
    <div className="notification-center" ref={container}>
      <button
        type="button"
        className={`icon-button notification-bell ${open ? "selected" : ""}`}
        aria-label="الإشعارات"
        aria-expanded={open}
        aria-controls="notification-list"
        aria-describedby={unread ? "notification-unread-label" : undefined}
        title={unread ? "توجد إشعارات جديدة" : "الإشعارات"}
        onClick={() => onOpenChange(!open)}
      >
        <Bell size={19} />
        {unread && (
          <>
            <span className="notification-unread-dot" aria-hidden="true" />
            <span id="notification-unread-label" className="sr-only">
              توجد إشعارات جديدة
            </span>
          </>
        )}
      </button>
      {open && (
        <section
          className="notification-popover"
          id="notification-list"
          aria-label="آخر الإشعارات"
        >
          <div className="notification-heading">
            <h3>الإشعارات</h3>
            <button
              type="button"
              className="mark-notifications-read"
              disabled={!unread}
              onClick={markRead}
            >
              <CheckCheck size={16} />
              تحديد الكل كمقروء
            </button>
          </div>
          {activities.length ? (
            <div className="notification-items">
              {activities.map((a) => (
                <div className="notification-item" key={a.id}>
                  <span
                    className={`activity-dot ${Date.parse(a.created_at) > readThrough ? "unread" : ""}`}
                  />
                  <p>
                    <strong>{a.actor_name}</strong> {a.action}
                    <small>
                      {tasks.find((t) => t.id === a.task_id)?.title}
                    </small>
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p>لا توجد إشعارات حتى الآن.</p>
          )}
        </section>
      )}
      {popup && (
        <aside
          ref={popupElement}
          popover="manual"
          className="notification-toast"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <span className="notification-toast-icon">
            <Bell size={20} />
          </span>
          <div>
            <strong>
              {popup.count > 1 ? `${popup.count} إشعارات جديدة` : "إشعار جديد"}
            </strong>
            <p>
              {popup.activity.actor_name} {popup.activity.action}
            </p>
            <small>{popup.title}</small>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="إغلاق الإشعار"
            onClick={() => setPopup(null)}
          >
            <X size={16} />
          </button>
        </aside>
      )}
    </div>
  );
}
