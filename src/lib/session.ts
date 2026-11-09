import { SignJWT, jwtVerify } from "jose";
import { NextRequest, NextResponse } from "next/server";

export type SessionUser = {
  id: number;
  username: string;
  fullName: string;
  role: string;
  permissions?: string[];
};

const COOKIE_NAME = "dan_pos_session";
const SESSION_SECONDS = 60 * 60 * 12;

function sessionKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 characters.");
  }
  return new TextEncoder().encode(secret);
}

export async function createSession(user: SessionUser): Promise<string> {
  return new SignJWT(user)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_SECONDS}s`)
    .sign(sessionKey());
}

export async function readSession(request: NextRequest): Promise<SessionUser | null> {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, sessionKey());
    if (
      typeof payload.id !== "number" ||
      typeof payload.username !== "string" ||
      typeof payload.fullName !== "string" ||
      typeof payload.role !== "string" ||
      (payload.permissions !== undefined &&
        (!Array.isArray(payload.permissions) || !payload.permissions.every((value) => typeof value === "string")))
    ) return null;
    return {
      id: payload.id,
      username: payload.username,
      fullName: payload.fullName,
      role: payload.role,
      ...(Array.isArray(payload.permissions) ? { permissions: payload.permissions as string[] } : {}),
    };
  } catch {
    return null;
  }
}

export function setSessionCookie(response: NextResponse, token: string): void {
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
}

export function requireSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}
