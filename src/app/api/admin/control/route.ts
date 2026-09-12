import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorize, fail, ApiError, serviceClient } from "@/lib/server";

const mustBeOwner = (role: string) =>
  role === "owner"
    ? null
    : new ApiError(403, "التحكم الكلي في النظام متاح للمالك فقط.");

export async function GET(req: NextRequest) {
  try {
    const { profile } = await authorize(req);
    const denied = mustBeOwner(profile.role);
    if (denied) throw denied;
    const { data, error } = await serviceClient()
      .from("app_settings")
      .select("system_suspended, system_suspend_reason")
      .eq("id", 1)
      .single();
    if (error) throw new ApiError(500, "تعذّر قراءة حالة النظام.");
    return NextResponse.json({
      system_suspended: Boolean(data?.system_suspended),
      system_suspend_reason: data?.system_suspend_reason ?? "",
    });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { profile } = await authorize(req);
    const denied = mustBeOwner(profile.role);
    if (denied) throw denied;
    const input = z
      .object({
        system_suspended: z.boolean(),
        system_suspend_reason: z.string().trim().max(200).default(""),
      })
      .parse(await req.json());
    const { error } = await serviceClient()
      .from("app_settings")
      .update({
        system_suspended: input.system_suspended,
        system_suspend_reason: input.system_suspend_reason,
      })
      .eq("id", 1);
    if (error) throw new ApiError(500, "تعذّر تحديث حالة النظام.");
    return NextResponse.json({
      system_suspended: input.system_suspended,
      system_suspend_reason: input.system_suspend_reason,
    });
  } catch (e) {
    return fail(e);
  }
}