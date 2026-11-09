import { NextRequest, NextResponse } from "next/server";
import { authorize, isResponse, requestJson, validationError } from "@/lib/api";
import { db } from "@/lib/db";
import { requireSameOrigin } from "@/lib/session";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Context) {
  if (!requireSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const user = await authorize(request, "orders.create");
  if (isResponse(user)) return user;
  const { id } = await context.params;
  if (!/^\d+$/.test(id)) return NextResponse.json({ error: "Invalid order." }, { status: 400 });
  const body = await requestJson(request);
  const productId = Number(body?.productId);
  const quantity = Number(body?.quantity);
  if (!Number.isSafeInteger(productId) || productId < 1 || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 999) {
    return NextResponse.json({ error: "Choose a product and a whole number quantity from 1 to 999." }, { status: 400 });
  }
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const orderResult = await client.query<{ id: string; status: string; discount_pct: string; vat_pct: string; service_pct: string }>(
      "SELECT id, status, discount_pct, vat_pct, service_pct FROM orders WHERE id = $1 FOR UPDATE", [id],
    );
    const order = orderResult.rows[0];
    if (!order || order.status === "cancelled" || order.status === "paid") throw validationError("This order can no longer be changed.");
    const productResult = await client.query<{ id: string; price: string; cost_price: string; is_available: boolean; stock_quantity: number }>(
      "SELECT id, price, cost_price, is_available, stock_quantity FROM products WHERE id = $1 FOR UPDATE", [productId],
    );
    const product = productResult.rows[0];
    if (!product?.is_available) throw validationError("This product is unavailable.");
    if (product.stock_quantity < quantity) throw validationError("There is not enough stock for this item.");
    const existing = await client.query<{ id: string; quantity: number; unit_price: string }>(
      "SELECT id, quantity, unit_price FROM order_items WHERE order_id=$1 AND product_id=$2 FOR UPDATE", [id, productId],
    );
    if (existing.rows[0]) {
      const nextQuantity = existing.rows[0].quantity + quantity;
      if (nextQuantity > 999) throw validationError("Item quantity is too large.");
      await client.query("UPDATE order_items SET quantity=$2, line_total=$3 WHERE id=$1",
        [existing.rows[0].id, nextQuantity, (Number(existing.rows[0].unit_price) * nextQuantity).toFixed(2)]);
    } else {
      await client.query(
        "INSERT INTO order_items (order_id, product_id, quantity, unit_price, unit_cost, line_total) VALUES ($1, $2, $3, $4, $5, $6)",
        [id, productId, quantity, product.price, product.cost_price, (Number(product.price) * quantity).toFixed(2)],
      );
    }
    const totals = await client.query<{ subtotal: string }>(
      "SELECT COALESCE(SUM(line_total), 0) AS subtotal FROM order_items WHERE order_id = $1", [id],
    );
    const subtotalCents = Math.round(Number(totals.rows[0].subtotal) * 100);
    const discount = Math.round(subtotalCents * Number(order.discount_pct) / 100);
    const taxable = subtotalCents - discount;
    const vat = Math.round(taxable * Number(order.vat_pct) / 100);
    const service = Math.round((taxable + vat) * Number(order.service_pct) / 100);
    const total = (taxable + vat + service) / 100;
    await client.query(
      "UPDATE orders SET subtotal=$2, discount_amount=$3, vat_amount=$4, service_amount=$5, total=$6 WHERE id=$1",
      [id, (subtotalCents / 100).toFixed(2), (discount / 100).toFixed(2), (vat / 100).toFixed(2), (service / 100).toFixed(2), total.toFixed(2)],
    );
    await client.query("INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details) VALUES ($1, 'update', 'order', $2, $3)",
      [user.id, String(id), JSON.stringify({ addedProductId: productId, quantity })]);
    await client.query("COMMIT");
    return NextResponse.json({ total: total.toFixed(2) });
  } catch (error) {
    await client.query("ROLLBACK");
    if (error instanceof Error && error.name === "ValidationError") return NextResponse.json({ error: error.message }, { status: 400 });
    console.error("Could not add items to order.", error);
    return NextResponse.json({ error: "Could not add items to order." }, { status: 500 });
  } finally { client.release(); }
}
