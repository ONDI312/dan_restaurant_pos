import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { clearSessionCookie, readSession } from "@/lib/session";

export async function GET(request: NextRequest) {
  const user = await readSession(request);
  if (!user) return NextResponse.json({ user: null });
  try {
    const result = await db.query<{
      username: string;
      full_name: string;
      role_name: string;
      permissions_customized: boolean;
    }>(
      "SELECT u.username, u.full_name, r.name AS role_name, u.permissions_customized "
      + "FROM users u JOIN roles r ON r.id = u.role_id "
      + "WHERE u.id = $1 AND u.is_active = TRUE",
      [user.id],
    );
    const activeUser = result.rows[0];
    if (!activeUser) {
      const response = NextResponse.json({ user: null });
      clearSessionCookie(response);
      return response;
    }
    const assigned = activeUser.permissions_customized
      ? await db.query<{ permission_name: string }>(
        "SELECT permission_name FROM user_permissions WHERE user_id = $1 ORDER BY permission_name",
        [user.id],
      )
      : null;
    return NextResponse.json({
      user: {
        id: user.id,
        username: activeUser.username,
        fullName: activeUser.full_name,
        role: activeUser.role_name,
        ...(assigned ? { permissions: assigned.rows.map((row) => row.permission_name) } : {}),
      },
    });
  } catch (error) {
    console.error("Could not validate session.", error);
    return NextResponse.json({ error: "Authentication is temporarily unavailable." }, { status: 503 });
  }
}
