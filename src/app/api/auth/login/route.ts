import argon2 from "argon2";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requestJson } from "@/lib/api";
import { createSession, requireSameOrigin, setSessionCookie } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!requireSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  const body = await requestJson(request);
  const username = typeof body?.username === "string" ? body.username.trim() : "";
  const pin = typeof body?.pin === "string" ? body.pin : "";
  if (!/^[^\u0000-\u001f\u007f]{1,64}$/u.test(username) || !/^\d{4,32}$/.test(pin)) {
    return NextResponse.json({ error: "Enter a valid username and 4–32 digit PIN." }, { status: 400 });
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "DELETE FROM web_login_attempts WHERE locked_until IS NULL "
      + "AND window_started_at < CURRENT_TIMESTAMP - INTERVAL '1 day'",
    );
    const lock = await client.query<{ locked_until: Date | null }>(
      "SELECT locked_until FROM web_login_attempts WHERE username = $1 FOR UPDATE",
      [username],
    );
    if (lock.rows[0]?.locked_until && lock.rows[0].locked_until > new Date()) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Too many failed sign-in attempts. Try again in 15 minutes." },
        { status: 429 },
      );
    }

    const result = await client.query<{
      id: string;
      username: string;
      full_name: string;
      pin_hash: string;
      role_name: string;
    }>(
      "SELECT u.id, u.username, u.full_name, u.pin_hash, r.name AS role_name "
      + "FROM users u JOIN roles r ON r.id = u.role_id "
      + "WHERE u.username = $1 AND u.is_active = TRUE",
      [username],
    );
    const account = result.rows[0];
    let verified = false;
    if (account) {
      try {
        verified = await argon2.verify(account.pin_hash, pin);
      } catch {
        verified = false;
      }
    }

    if (!verified || !account) {
      await client.query(
        `INSERT INTO web_login_attempts (username, window_started_at, attempts, locked_until)
         VALUES ($1, CURRENT_TIMESTAMP, 1, NULL)
         ON CONFLICT (username) DO UPDATE SET
           attempts = CASE
             WHEN web_login_attempts.window_started_at < CURRENT_TIMESTAMP - INTERVAL '15 minutes'
               THEN 1 ELSE web_login_attempts.attempts + 1 END,
           locked_until = CASE
             WHEN web_login_attempts.window_started_at < CURRENT_TIMESTAMP - INTERVAL '15 minutes'
               THEN NULL
             WHEN web_login_attempts.attempts + 1 >= 8
               THEN CURRENT_TIMESTAMP + INTERVAL '15 minutes'
             ELSE web_login_attempts.locked_until END,
           window_started_at = CASE
             WHEN web_login_attempts.window_started_at < CURRENT_TIMESTAMP - INTERVAL '15 minutes'
               THEN CURRENT_TIMESTAMP ELSE web_login_attempts.window_started_at END`,
        [username],
      );
      await client.query("COMMIT");
      return NextResponse.json({ error: "Username or PIN is incorrect." }, { status: 401 });
    }

    await client.query("DELETE FROM web_login_attempts WHERE username = $1", [username]);
    await client.query("UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1", [account.id]);
    await client.query("COMMIT");

    const user = {
      id: Number(account.id),
      username: account.username,
      fullName: account.full_name,
      role: account.role_name,
    };
    const token = await createSession(user);
    const response = NextResponse.json({ user });
    setSessionCookie(response, token);
    return response;
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Web sign-in failed.", error);
    return NextResponse.json({ error: "Sign-in is temporarily unavailable." }, { status: 503 });
  } finally {
    client.release();
  }
}
