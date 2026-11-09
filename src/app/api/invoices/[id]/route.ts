import { NextRequest, NextResponse } from "next/server";
import { authorize, isResponse, validationError } from "@/lib/api";
import { db } from "@/lib/db";
import { requireSameOrigin } from "@/lib/session";

type Context = { params: Promise<{ id: string }> };

export async function DELETE(request: NextRequest, context: Context) {
  if (!requireSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }
  const user = await authorize(request, "invoices.delete");
  if (isResponse(user)) return user;
  const { id } = await context.params;
  if (!/^\d+$/.test(id) || Number(id) <= 0) {
    return NextResponse.json({ error: "Choose a valid invoice." }, { status: 400 });
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{
      id: string;
      invoice_number: string;
      order_id: string;
      order_number: string;
      order_status: string;
      deleted_at: string | null;
    }>(
      `SELECT i.id, i.invoice_number, i.order_id, o.order_number,
              o.status AS order_status, i.deleted_at
       FROM invoices i JOIN orders o ON o.id = i.order_id
       WHERE i.id = $1 FOR UPDATE OF i, o`,
      [id],
    );
    const invoice = result.rows[0];
    if (!invoice || invoice.deleted_at) throw validationError("This invoice was not found or has already been removed.");
    if (invoice.order_status !== "paid") throw validationError("Only settled invoices can be removed.");

    await client.query(
      "UPDATE invoices SET deleted_at = CURRENT_TIMESTAMP, deleted_by = $2 WHERE id = $1",
      [invoice.id, user.id],
    );
    await client.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
       VALUES ($1, 'delete', 'invoice', $2, $3)`,
      [user.id, invoice.id, JSON.stringify({
        invoiceNumber: invoice.invoice_number,
        orderId: invoice.order_id,
        orderNumber: invoice.order_number,
        retainedSettledSale: true,
      })],
    );
    await client.query("COMMIT");
    return NextResponse.json({ ok: true });
  } catch (error) {
    await client.query("ROLLBACK");
    if (error instanceof Error && error.name === "ValidationError") {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Could not remove invoice.", error);
    return NextResponse.json({ error: "Could not remove invoice." }, { status: 500 });
  } finally {
    client.release();
  }
}
