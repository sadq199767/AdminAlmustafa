import { NextRequest, NextResponse } from "next/server";
import { authorize, fail, serviceClient, serviceReady } from "@/lib/server";
export const dynamic = "force-dynamic";
async function readAll(
  db: Awaited<ReturnType<typeof authorize>>["db"],
  table: string,
  order: string,
) {
  const rows: Record<string, unknown>[] = [];
  for (let offset = 0; offset < 100000; offset += 500) {
    const { data, error } = await db
      .from(table)
      .select("*")
      .order(order, { ascending: table === "employees" })
      .order("id")
      .range(offset, offset + 499);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 500) return { data: rows, error: null };
  }
  throw new Error("Dataset exceeds the supported interactive limit.");
}
export async function GET(req: NextRequest) {
  try {
    const { db, profile } = await authorize(req);
    const results = await Promise.all([
      readAll(db, "employees", "created_at"),
      readAll(db, "tasks", "created_at"),
      readAll(db, "attendance", "work_date"),
      readAll(db, "daily_reports", "report_date"),
      db
        .from("task_activities")
        .select("id,task_id,actor_name,action,created_at")
        .order("created_at", { ascending: false })
        .limit(20),
      db.from("app_settings").select("*").eq("id", 1).single(),
    ]);
    if (results.some((r) => r.error)) throw new Error("Database read failed");
    let botConfigured = false;
    if (serviceReady()) {
      const { count } = await serviceClient()
        .from("bot_secrets")
        .select("id", { count: "exact", head: true });
      botConfigured = !!count;
    }
    return NextResponse.json(
      {
        profile,
        employees: results[0].data,
        tasks: results[1].data,
        attendance: results[2].data,
        reports: results[3].data,
        activities: results[4].data,
        settings: {
          ...results[5].data,
          bot_configured: botConfigured,
          server_ready:
            serviceReady() && Boolean(process.env.BOT_ENCRYPTION_KEY),
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return fail(e);
  }
}
