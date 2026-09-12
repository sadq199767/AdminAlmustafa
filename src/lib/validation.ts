import { z } from "zod";
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !Number.isNaN(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
    "التاريخ غير صالح",
  );
export const employeeSchema = z.object({
  name: z.string().trim().min(2).max(100),
  phone: z.string().trim().max(30).default(""),
  profession: z.string().trim().min(2).max(100),
  telegram_id: z
    .string()
    .trim()
    .regex(/^-?\d*$|^$/)
    .max(30)
    .default(""),
  daily_hours: z.number().min(0.5).max(24),
  joined_on: date,
  supervisor_id: z.string().uuid().nullable().optional().default(null),
});
export const createEmployeeSchema = employeeSchema
  .extend({
    email: z.string().trim().email().optional(),
    password: z.string().min(6).max(12).optional(),
  })
  .superRefine((input, ctx) => {
    if ((input.email !== undefined) !== (input.password !== undefined)) {
      ctx.addIssue({
        code: "custom",
        path: [input.email === undefined ? "email" : "password"],
        message: "أدخل البريد وكلمة المرور معًا.",
      });
    }
  });
export const taskSchema = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().max(5000).default(""),
  employee_id: z.string().uuid().optional(),
  assignee_ids: z.array(z.string().uuid()).optional().default([]),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
  due_date: date.nullable().default(null),
});
export const statusSchema = z.object({
  status: z.enum(["todo", "in_progress", "done"]),
});
export const commentSchema = z.object({
  body: z.string().trim().min(1).max(2000),
});
export const settingsSchema = z.object({
  organization_name: z.string().trim().min(2).max(100),
  work_days: z
    .array(z.number().int().min(0).max(6))
    .min(1)
    .max(7)
    .transform((v) => [...new Set(v)]),
  telegram_enabled: z.boolean(),
  idle_threshold_minutes: z.number().int().min(1).max(60),
});
export const attendanceSchema = z
  .object({
    id: z.string().uuid(),
    work_date: date,
    started_at: z.string().datetime(),
    ended_at: z.string().datetime().nullable(),
    attendance_seconds: z.number().int().min(0).max(86400),
    active_seconds: z.number().int().min(0).max(86400),
  })
  .refine(
    (v) => v.active_seconds <= v.attendance_seconds,
    "وقت العمل يتجاوز الدوام",
  )
  .refine(
    (v) => !v.ended_at || new Date(v.ended_at) >= new Date(v.started_at),
    "ترتيب الوقت غير صالح",
  );
