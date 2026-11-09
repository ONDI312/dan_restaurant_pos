import { NextRequest, NextResponse } from "next/server";
import { authorize, isResponse } from "@/lib/api";
import { db } from "@/lib/db";
import { resolveProductImage } from "@/lib/product-images";

export async function GET(request: NextRequest) {
  const user = await authorize(request, "reports.view");
  if (isResponse(user)) return user;
  const period = request.nextUrl.searchParams.get("period") === "month" ? "month" : "week";
  try {
    const settings = await db.query<{ value: string }>("SELECT value FROM settings WHERE key='currency' LIMIT 1");
    const currency = /^[A-Z]{3}$/.test(settings.rows[0]?.value ?? "") ? settings.rows[0].value : "USD";
    const rangeStart = `CASE WHEN $1 = 'month' THEN date_trunc('month', CURRENT_DATE)
      ELSE date_trunc('week', CURRENT_DATE) - INTERVAL '1 day' END`;
    const rangeEnd = `CASE WHEN $1 = 'month' THEN date_trunc('month', CURRENT_DATE) + INTERVAL '1 month'
      ELSE date_trunc('week', CURRENT_DATE) + INTERVAL '6 days' END`;
    const [sales, stock, tables, counters, weekly, activity, dishes] = await Promise.all([
      db.query(
        `SELECT currency, COUNT(*) AS order_count, SUM(total) AS total FROM orders
         WHERE status='paid' AND created_at >= CURRENT_DATE GROUP BY currency ORDER BY currency`,
      ),
      db.query(
        `SELECT id, name, stock_quantity, min_stock FROM products
         WHERE is_available = TRUE AND stock_quantity <= min_stock ORDER BY stock_quantity, name LIMIT 8`,
      ),
      db.query(
        `SELECT COUNT(*) FILTER (WHERE status = 'available') AS available,
                COUNT(*) FILTER (WHERE status = 'occupied') AS occupied,
                COUNT(*) AS total FROM restaurant_tables WHERE is_active = TRUE`,
      ),
      db.query(
        `SELECT COUNT(*) FILTER (WHERE kitchen_status='pending' AND status!='cancelled') AS pending,
                COUNT(*) FILTER (WHERE kitchen_status IN ('preparing','ready') AND status!='cancelled') AS in_progress,
                COUNT(*) FILTER (WHERE status!='cancelled' AND created_at >= ${rangeStart} AND created_at < ${rangeEnd}) AS total_orders,
                COUNT(DISTINCT customer_name) FILTER (WHERE status!='cancelled' AND customer_name IS NOT NULL AND btrim(customer_name)!='' AND created_at >= ${rangeStart} AND created_at < ${rangeEnd}) AS customers,
                COALESCE(SUM(total) FILTER (WHERE status='paid' AND currency=$2 AND created_at >= ${rangeStart} AND created_at < ${rangeEnd}),0) AS range_revenue,
                COUNT(*) FILTER (WHERE status='paid' AND currency=$2 AND created_at >= ${rangeStart} AND created_at < ${rangeEnd}) AS paid_orders
                , COUNT(*) FILTER (WHERE status!='cancelled' AND kitchen_status='completed' AND created_at >= ${rangeStart} AND created_at < ${rangeEnd}) AS completed
         FROM orders`, [period, currency],
      ),
      db.query(
        `SELECT EXTRACT(DOW FROM created_at)::int AS day, COALESCE(SUM(total),0) AS revenue,
                COALESCE(SUM(subtotal),0) AS subtotal,
                COUNT(*) AS order_count
         FROM orders WHERE status='paid' AND currency=$2 AND created_at >= ${rangeStart} AND created_at < ${rangeEnd}
         GROUP BY day ORDER BY day`, [period, currency],
      ),
      db.query<{ id: number; order_number: string; total: string; currency: string; status: string; kitchen_status: string; created_at: string; customer_name: string | null; dish_name: string | null; image_path: string | null }>(
        `SELECT o.id, o.order_number, o.total, o.currency, o.status, o.kitchen_status, o.created_at,
                o.customer_name, p.name AS dish_name, p.image_path
         FROM orders o LEFT JOIN LATERAL (
           SELECT product_id FROM order_items WHERE order_id=o.id ORDER BY id LIMIT 1
         ) oi ON TRUE LEFT JOIN products p ON p.id=oi.product_id
         WHERE o.status!='cancelled' ORDER BY o.created_at DESC LIMIT 4`,
      ),
      db.query<{ id: number; name: string; image_path: string | null; completed_orders: number }>(
        `SELECT p.id, p.name, p.image_path, COUNT(DISTINCT o.id) AS completed_orders
         FROM order_items oi JOIN orders o ON o.id=oi.order_id JOIN products p ON p.id=oi.product_id
         WHERE o.status='paid' AND o.created_at >= ${rangeStart} AND o.created_at < ${rangeEnd}
         GROUP BY p.id, p.name, p.image_path ORDER BY completed_orders DESC, p.name LIMIT 5`, [period],
      ),
    ]);
    const resolveImages = async <T extends { image_path: string | null }>(rows: T[]) => Promise.all(
      rows.map(async (row) => ({ ...row, image_path: await resolveProductImage(row.image_path) })),
    );
    return NextResponse.json({
      sales: sales.rows,
      lowStock: stock.rows,
      tables: tables.rows[0] ?? { available: 0, occupied: 0 },
      counters: counters.rows[0],
      weekly: weekly.rows,
      activity: await resolveImages(activity.rows),
      dishes: await resolveImages(dishes.rows),
      currency,
      period,
    });
  } catch (error) {
    console.error("Could not load dashboard.", error);
    return NextResponse.json({ error: "Could not load dashboard." }, { status: 500 });
  }
}
