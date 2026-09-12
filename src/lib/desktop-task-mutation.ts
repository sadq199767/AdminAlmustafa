import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authorize, assertSystemRunning, ApiError, fail } from '@/lib/server';
import { notifyTask } from '@/lib/telegram';

const schema = z.object({
  client_id: z.string().uuid().optional(),
  title: z.string().trim().min(3).max(200),
  description: z.string().max(5000).default(''),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  assignee_ids: z.array(z.string().uuid()).max(8).default([]),
});

export async function saveDesktopTask(req: NextRequest, id?: string) {
  try {
    const { db, profile } = await authorize(req, true);
    await assertSystemRunning();
    if (id) z.uuid().parse(id);
    const input = schema.parse(await req.json());
    const { data, error } = await db.rpc('save_employee_task', {
      p_id: id ?? input.client_id ?? crypto.randomUUID(), p_create: !id,
      p_title: input.title, p_description: input.description, p_priority: input.priority,
      p_due_date: input.due_date, p_assignee_ids: input.assignee_ids,
    });
    if (error) throw new ApiError(error.code === '42501' ? 403 : error.code === 'P0002' ? 404 : 400, error.message);
    void notifyTask(db, data, profile, id ? 'عدّل مهمة' : 'أضاف مهمة جديدة');
    return NextResponse.json(data);
  } catch (error) { return fail(error); }
}
