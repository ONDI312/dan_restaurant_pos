import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { authorize, isResponse, requestJson, validationError } from "@/lib/api";
import { db } from "@/lib/db";
import { requireSameOrigin } from "@/lib/session";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Context) {
  if (!requireSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }
  const user = await authorize(request, "payments.record");
  if (isResponse(user)) return user;
  const { id } = await context.params;
  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ error: "Invalid order." }, { status: 400 });
  }
  const body = await requestJson(request);
  const method = typeof body?.method === "string" ? body.method.trim().toLowerCase() : "";
  const amountString = typeof body?.amount === "string" || typeof body?.amount === "number"
    ? String(body.amount)
    : "";
  const amount = Number(amountString);
  if (
    !["cash", "card", "m-pesa", "bank-transfer"].includes(method) ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    amount > 9_999_999_999.99
  ) {
    return NextResponse.json({ error: "Choose a valid payment method and amount." }, { status: 400 });
  }
  const transactionRefValue = typeof body?.transactionRef === "string"
    ? body.transactionRef.trim().slice(0, 100)
    : "";
  const transactionRef = transactionRefValue || null;
  if (method === "m-pesa" && !transactionRef) {
    return NextResponse.json({ error: "Enter the M-Pesa confirmation code." }, { status: 400 });
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const orderResult = await client.query<{
      id: string;
      total: string;
      status: string;
      table_id: string | null;
    }>("SELECT id, total, status, table_id FROM orders WHERE id = $1 FOR UPDATE", [id]);
    const order = orderResult.rows[0];
    if (!order) throw validationError("Order was not found.");
    if (order.status === "cancelled" || order.status === "paid") {
      throw validationError("This order cannot accept another payment.");
    }
    if (method === "m-pesa" && transactionRef) {
      const duplicate = await client.query(
        "SELECT id FROM payments WHERE method = 'm-pesa' AND transaction_ref IS NOT NULL "
        + "AND lower(btrim(transaction_ref)) = lower($1) LIMIT 1",
        [transactionRef],
      );
      if (duplicate.rowCount) throw validationError("This M-Pesa confirmation code has already been used.");
    }
    const paidResult = await client.query<{ paid: string }>(
      "SELECT COALESCE(SUM(amount_paid), 0) AS paid FROM payments "
      + "WHERE order_id = $1 AND status = 'paid'",
      [id],
    );
    const moneyCents = (value: string) => Math.round(Number(value) * 100);
    const dueCents = Math.max(moneyCents(order.total) - moneyCents(paidResult.rows[0].paid), 0);
    const paidCents = Math.round(amount * 100);
    if (paidCents > dueCents) throw validationError("Payment amount cannot exceed the remaining balance.");
    const remainingCents = dueCents - paidCents;
    const orderPaid = remainingCents === 0;
    const payment = await client.query<{ id: string }>(
      `INSERT INTO payments
       (order_id, method, amount_paid, transaction_ref, status, paid_at)
       VALUES ($1, $2, $3, $4, 'paid', CURRENT_TIMESTAMP)
       RETURNING id`,
      [id, method, (paidCents / 100).toFixed(2), transactionRef],
    );

    if (orderPaid) {
      await client.query("UPDATE orders SET status = 'paid' WHERE id = $1", [id]);
      if (order.table_id) {
        await client.query(
          "UPDATE restaurant_tables SET status = 'available' WHERE id = $1",
          [order.table_id],
        );
      }
      const items = await client.query<{ product_id: string; quantity: number }>(
        "SELECT product_id, quantity FROM order_items WHERE order_id = $1",
        [id],
      );
      for (const item of items.rows) {
        const stock = await client.query(
          "UPDATE products SET stock_quantity = stock_quantity - $1 "
          + "WHERE id = $2 AND stock_quantity >= $1",
          [item.quantity, item.product_id],
        );
        if (stock.rowCount !== 1) throw validationError("Insufficient stock to complete this order.");
        await client.query(
          `INSERT INTO inventory_movements
           (product_id, quantity, movement_type, reason, user_id, related_order_id)
           VALUES ($1, $2, 'sale', 'Paid order', $3, $4)`,
          [item.product_id, item.quantity, user.id, id],
        );
      }
      await client.query(
        "INSERT INTO invoices (invoice_number, order_id) VALUES ($1, $2) "
        + "ON CONFLICT (order_id) DO NOTHING",
        [`INV-${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`, id],
      );
    }

    await client.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
       VALUES ($1, 'record', 'payment', $2, $3)`,
      [user.id, payment.rows[0].id, JSON.stringify({
        orderId: id,
        method,
        amount: paidCents / 100,
        status: orderPaid ? "paid" : "partial",
      })],
    );
    await client.query("COMMIT");
    return NextResponse.json({
      paymentId: payment.rows[0].id,
      status: orderPaid ? "paid" : "partial",
      remainingDue: (remainingCents / 100).toFixed(2),
    });
  } catch (error) {
    await client.query("ROLLBACK");
    if (error instanceof Error && error.name === "ValidationError") {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "23505" &&
      "constraint" in error &&
      error.constraint === "idx_payments_mpesa_transaction_ref"
    ) {
      return NextResponse.json({ error: "This M-Pesa confirmation code has already been used." }, { status: 409 });
    }
    console.error("Could not record payment.", error);
    return NextResponse.json({ error: "Could not record payment." }, { status: 500 });
  } finally {
    client.release();
  }
}
