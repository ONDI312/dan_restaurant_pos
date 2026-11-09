import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookie, requireSameOrigin } from "@/lib/session";

export async function POST(request: NextRequest) {
  if (!requireSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }
  const response = NextResponse.json({ ok: true });
  clearSessionCookie(response);
  return response;
}
