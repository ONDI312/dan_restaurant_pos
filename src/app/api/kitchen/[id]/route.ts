import { NextRequest, NextResponse } from "next/server";
import { authorize, isResponse, validationError } from "@/lib/api";
import { db } from "@/lib/db";
import { requireSameOrigin } from "@/lib/session";

type Context = { params: Promise<{ id: string }> };
const nextStatus: Record<string, string> = {
  pending: "preparing",
  preparing: "ready",
  ready: "completed",
};

export async function POST(request: NextRequest, context: Context) {
  if (!requireSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }
  const user = await authorize(request, "kitchen.use");
  if (isResponse(user)) return user;
  const { id } = await context.params;
  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ error: "Invalid ticket." }, { status: 400 });
  }
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query<{ kitchen_status: string }>(
      "SELECT kitchen_status FROM orders WHERE id = $1 AND status != 'cancelled' FOR UPDATE",
      [id],
    );
    const status = current.rows[0]?.kitchen_status;
    if (!status || !nextStatus[status]) throw validationError("Ticket not found or already complete.");
    const result = await client.query(
      "UPDATE orders SET kitchen_status = $1 WHERE id = $2 AND kitchen_status = $3",
      [nextStatus[status], id, status],
    );
    if (result.rowCount !== 1) throw validationError("Ticket changed; refresh and try again.");
    await client.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
       VALUES ($1, 'advance', 'kitchen_ticket', $2, $3)`,
      [user.id, id, JSON.stringify({ from: status, to: nextStatus[status] })],
    );
    await client.query("COMMIT");
    return NextResponse.json({ status: nextStatus[status] });
  } catch (error) {
    await client.query("ROLLBACK");
    if (error instanceof Error && error.name === "ValidationError") {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Could not advance kitchen ticket.", error);
    return NextResponse.json({ error: "Could not advance kitchen ticket." }, { status: 500 });
  } finally {
    client.release();
  }
}
