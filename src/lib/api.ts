import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { readSession, type SessionUser } from "@/lib/session";

export async function authorize(
  request: NextRequest,
  permission: string,
): Promise<SessionUser | NextResponse> {
  const user = await readSession(request);
  if (!user) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }
  let currentRole: string | undefined;
  let permissionsCustomized = false;
  try {
    const activeUser = await db.query<{ role_name: string; permissions_customized: boolean }>(
      "SELECT r.name AS role_name, u.permissions_customized FROM users u JOIN roles r ON r.id = u.role_id "
      + "WHERE u.id = $1 AND u.is_active = TRUE",
      [user.id],
    );
    currentRole = activeUser.rows[0]?.role_name;
    permissionsCustomized = activeUser.rows[0]?.permissions_customized ?? false;
  } catch (error) {
    console.error("Could not verify the active user.", error);
    return NextResponse.json({ error: "Authentication is temporarily unavailable." }, { status: 503 });
  }
  if (!currentRole) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }
  user.role = currentRole;
  if (permissionsCustomized) {
    try {
      const assigned = await db.query<{ permission_name: string }>(
        "SELECT permission_name FROM user_permissions WHERE user_id = $1",
        [user.id],
      );
      user.permissions = assigned.rows.map((row) => row.permission_name);
    } catch (error) {
      console.error("Could not load user privileges.", error);
      return NextResponse.json({ error: "Authorization is temporarily unavailable." }, { status: 503 });
    }
  } else {
    user.permissions = undefined;
  }
  if (!can(user.role, permission, user.permissions)) {
    return NextResponse.json({ error: "You do not have permission for this action." }, { status: 403 });
  }
  return user;
}

export function isResponse(value: SessionUser | NextResponse): value is NextResponse {
  return value instanceof NextResponse;
}

export async function requestJson(request: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return body !== null && typeof body === "object" && !Array.isArray(body)
      ? body as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function validationError(message: string): Error {
  const error = new Error(message);
  error.name = "ValidationError";
  return error;
}
