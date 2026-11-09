import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { authorize, isResponse, requestJson, validationError } from "@/lib/api";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { readSession, requireSameOrigin } from "@/lib/session";

function cents(value: string | number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw validationError("Invalid money amount.");
  return Math.round(parsed * 100);
}

function rate(value: string | undefined, fallback: string): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    throw validationError("Tax and discount rates must be between 0 and 100.");
  }
  return Math.round(parsed * 100);
}

function amount(centsValue: number): string {
  return (centsValue / 100).toFixed(2);
}

export async function GET(request: NextRequest) {
  const user = await readSession(request);
  if (!user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  try {
    const activeUser = await db.query<{ role_name: string }>(
      "SELECT r.name AS role_name FROM users u JOIN roles r ON r.id = u.role_id "
      + "WHERE u.id = $1 AND u.is_active = TRUE",
      [user.id],
    );
    const currentRole = activeUser.rows[0]?.role_name;
    if (!currentRole) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
    user.role = currentRole;
    const kitchenView = can(user.role, "kitchen.use");
    if (!kitchenView && !can(user.role, "invoices.view")) {
      return NextResponse.json({ error: "You do not have permission for this action." }, { status: 403 });
    }
    if (kitchenView && !can(user.role, "invoices.view")) {
      const tickets = await db.query(
        `SELECT o.id, o.order_number, o.order_type, o.created_at, o.kitchen_status,
                t.table_name
         FROM orders o LEFT JOIN restaurant_tables t ON t.id = o.table_id
         WHERE o.kitchen_status IN ('pending', 'preparing', 'ready')
           AND o.status != 'cancelled'
         ORDER BY o.created_at, o.id`,
      );
      const orders = await Promise.all(tickets.rows.map(async (ticket) => {
        const items = await db.query(
          `SELECT p.name, oi.quantity, oi.special_instructions
           FROM order_items oi JOIN products p ON p.id = oi.product_id
           WHERE oi.order_id = $1 ORDER BY oi.id`,
          [ticket.id],
        );
        return { ...ticket, items: items.rows };
      }));
      return NextResponse.json({ orders });
    }
    const result = await db.query(
      `SELECT o.id, o.order_number, o.order_type, o.total, o.currency, o.status,
              o.kitchen_status, o.created_at, t.table_name,
              u.full_name AS cashier,
              (SELECT p.method FROM payments p
               WHERE p.order_id = o.id AND p.status = 'paid'
               ORDER BY p.id DESC LIMIT 1) AS payment_method
       FROM orders o
       LEFT JOIN restaurant_tables t ON t.id = o.table_id
       LEFT JOIN users u ON u.id = o.created_by
       ORDER BY o.created_at DESC LIMIT 100`,
    );
    return NextResponse.json({ orders: result.rows });
  } catch (error) {
    console.error("Could not load orders.", error);
    return NextResponse.json({ error: "Could not load orders." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!requireSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }
  const user = await authorize(request, "orders.create");
  if (isResponse(user)) return user;
  const body = await requestJson(request);
  const orderType = body?.orderType;
  const tableId = body?.tableId;
  const lines = body?.items;
  if (
    (orderType !== "take_away" && orderType !== "dine_in") ||
    (orderType === "dine_in" && (!Number.isSafeInteger(tableId) || Number(tableId) <= 0)) ||
    !Array.isArray(lines) ||
    lines.length < 1 ||
    lines.length > 50
  ) {
    return NextResponse.json({ error: "Choose an order type and add valid items." }, { status: 400 });
  }

  const merged = new Map<number, number>();
  for (const raw of lines) {
    if (
      raw === null ||
      typeof raw !== "object" ||
      !Number.isSafeInteger(raw.productId) ||
      raw.productId <= 0 ||
      !Number.isSafeInteger(raw.quantity) ||
      raw.quantity < 1 ||
      raw.quantity > 999
    ) {
      return NextResponse.json({ error: "Invalid item quantity." }, { status: 400 });
    }
    merged.set(raw.productId, (merged.get(raw.productId) ?? 0) + raw.quantity);
  }
  if ([...merged.values()].some((quantity) => quantity > 999)) {
    return NextResponse.json({ error: "Item quantity is too large." }, { status: 400 });
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const settingsResult = await client.query<{ key: string; value: string }>(
      "SELECT key, value FROM settings WHERE key = ANY($1::text[])",
      [["currency", "discount_percentage", "vat_percentage", "service_percentage"]],
    );
    const settings = Object.fromEntries(settingsResult.rows.map((row) => [row.key, row.value]));
    const currency = /^[A-Z]{3}$/.test(settings.currency ?? "") ? settings.currency : "USD";
    const discountRate = rate(settings.discount_percentage, "0");
    const vatRate = rate(settings.vat_percentage, "0");
    const serviceRate = rate(settings.service_percentage, "0");
    const ids = [...merged.keys()].sort((a, b) => a - b);
    const productResult = await client.query<{
      id: string;
      name: string;
      price: string;
      cost_price: string;
      stock_quantity: number;
      is_available: boolean;
    }>(
      "SELECT id, name, price, cost_price, stock_quantity, is_available "
      + "FROM products WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE",
      [ids],
    );
    if (
      productResult.rows.length !== ids.length ||
      productResult.rows.some((product) =>
        !product.is_available || product.stock_quantity < (merged.get(Number(product.id)) ?? 0),
      )
    ) {
      throw validationError("A product is unavailable or does not have enough stock.");
    }

    let subtotalCents = 0;
    const items = productResult.rows.map((product) => {
      const quantity = merged.get(Number(product.id))!;
      const unitPriceCents = cents(product.price);
      const lineCents = unitPriceCents * quantity;
      subtotalCents += lineCents;
      return {
        product,
        quantity,
        unitPrice: amount(unitPriceCents),
        lineTotal: amount(lineCents),
      };
    });
    if (!Number.isSafeInteger(subtotalCents) || subtotalCents > 999_999_999_999) {
      throw validationError("Order total exceeds the supported limit.");
    }
    const discountCents = Math.round(subtotalCents * discountRate / 10_000);
    const taxableCents = subtotalCents - discountCents;
    const vatCents = Math.round(taxableCents * vatRate / 10_000);
    const serviceCents = Math.round((taxableCents + vatCents) * serviceRate / 10_000);
    const totalCents = taxableCents + vatCents + serviceCents;
    const orderNumber = `ORD-${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;

    if (orderType === "dine_in") {
      const table = await client.query(
        "SELECT id FROM restaurant_tables WHERE id = $1 AND is_active = TRUE "
        + "AND status = 'available' FOR UPDATE",
        [tableId],
      );
      if (table.rowCount !== 1) throw validationError("The selected table is not available.");
    }

    const order = await client.query<{ id: string }>(
      `INSERT INTO orders
       (order_number, order_type, table_id, subtotal, currency, discount_pct,
        discount_amount, vat_pct, vat_amount, service_pct, service_amount, total,
        status, kitchen_status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'open', 'pending', $13)
       RETURNING id`,
      [
        orderNumber, orderType, orderType === "dine_in" ? tableId : null,
        amount(subtotalCents), currency, discountRate / 100, amount(discountCents),
        vatRate / 100, amount(vatCents), serviceRate / 100, amount(serviceCents),
        amount(totalCents), user.id,
      ],
    );
    const orderId = Number(order.rows[0].id);
    for (const item of items) {
      await client.query(
        `INSERT INTO order_items
         (order_id, product_id, quantity, unit_price, unit_cost, line_total)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          orderId, item.product.id, item.quantity, item.unitPrice,
          item.product.cost_price, item.lineTotal,
        ],
      );
    }
    if (orderType === "dine_in") {
      await client.query(
        "UPDATE restaurant_tables SET status = 'occupied' WHERE id = $1",
        [tableId],
      );
    }
    await client.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
       VALUES ($1, 'create', 'order', $2, $3)`,
      [user.id, String(orderId), JSON.stringify({ orderNumber, currency, total: amount(totalCents) })],
    );
    await client.query("COMMIT");
    return NextResponse.json(
      { orderId, orderNumber, currency, total: amount(totalCents) },
      { status: 201 },
    );
  } catch (error) {
    await client.query("ROLLBACK");
    if (error instanceof Error && error.name === "ValidationError") {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Could not create order.", error);
    return NextResponse.json({ error: "Could not create order." }, { status: 500 });
  } finally {
    client.release();
  }
}
