import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { clearSessionCookie, readSession } from "@/lib/session";

export async function GET(request: NextRequest) {
  const user = await readSession(request);
  if (!user) return NextResponse.json({ user: null });
  try {
    const result = await db.query<{ username: string; full_name: string; role_name: string }>(
      "SELECT u.username, u.full_name, r.name AS role_name "
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
    return NextResponse.json({
      user: {
        ...user,
        username: activeUser.username,
        fullName: activeUser.full_name,
        role: activeUser.role_name,
      },
    });
  } catch (error) {
    console.error("Could not validate session.", error);
    return NextResponse.json({ error: "Authentication is temporarily unavailable." }, { status: 503 });
  }
}
