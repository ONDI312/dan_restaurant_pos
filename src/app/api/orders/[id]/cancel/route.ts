import { NextRequest, NextResponse } from "next/server";
import { authorize, isResponse, validationError } from "@/lib/api";
import { db } from "@/lib/db";
import { requireSameOrigin } from "@/lib/session";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Context) {
  if (!requireSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }
  const user = await authorize(request, "orders.cancel");
  if (isResponse(user)) return user;
  const { id } = await context.params;
  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ error: "Invalid order." }, { status: 400 });
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{ status: string; table_id: string | null }>(
      "SELECT status, table_id FROM orders WHERE id = $1 FOR UPDATE",
      [id],
    );
    const order = result.rows[0];
    if (!order || order.status === "cancelled" || order.status === "paid") {
      throw validationError("Only unpaid, active orders can be cancelled.");
    }
    const payments = await client.query<{ paid: string }>(
      "SELECT COALESCE(SUM(amount_paid), 0) AS paid FROM payments WHERE order_id = $1 AND status = 'paid'",
      [id],
    );
    if (Number(payments.rows[0].paid) > 0) {
      throw validationError("An order with recorded payments cannot be cancelled. Resolve its payment first.");
    }
    await client.query("UPDATE orders SET status = 'cancelled' WHERE id = $1", [id]);
    if (order.table_id) {
      await client.query(
        "UPDATE restaurant_tables SET status = 'available' WHERE id = $1 AND status = 'occupied'",
        [order.table_id],
      );
    }
    await client.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
       VALUES ($1, 'cancel', 'order', $2, $3)`,
      [user.id, id, JSON.stringify({ previousStatus: order.status })],
    );
    await client.query("COMMIT");
    return NextResponse.json({ ok: true });
  } catch (error) {
    await client.query("ROLLBACK");
    if (error instanceof Error && error.name === "ValidationError") {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Could not cancel order.", error);
    return NextResponse.json({ error: "Could not cancel order." }, { status: 500 });
  } finally {
    client.release();
  }
}
