import { NextRequest, NextResponse } from "next/server";
import { authorize, isResponse } from "@/lib/api";
import { db } from "@/lib/db";

export async function GET(request: NextRequest) {
  const user = await authorize(request, "reports.view");
  if (isResponse(user)) return user;
  const start = request.nextUrl.searchParams.get("from");
  const end = request.nextUrl.searchParams.get("to");
  if (
    !start || !end ||
    !/^\d{4}-\d{2}-\d{2}$/.test(start) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(end) ||
    start > end
  ) {
    return NextResponse.json({ error: "Choose a valid date range." }, { status: 400 });
  }
  const params = [start, end];
  const range = "created_at >= $1::date AND created_at < $2::date + INTERVAL '1 day'";
  try {
    const [sales, expenses, products, categories, cashiers, payments, profit] = await Promise.all([
      db.query(
        `SELECT currency, COUNT(*) AS order_count, COALESCE(SUM(total), 0) AS total
         FROM orders WHERE status = 'paid' AND ${range}
         GROUP BY currency ORDER BY currency`,
        params,
      ),
      db.query(
        `SELECT currency, COALESCE(SUM(amount), 0) AS total
         FROM expenses WHERE ${range} GROUP BY currency ORDER BY currency`,
        params,
      ),
      db.query(
        `SELECT p.name, o.currency, SUM(oi.quantity) AS quantity,
                SUM(oi.line_total) AS sales
         FROM order_items oi JOIN orders o ON o.id = oi.order_id
         JOIN products p ON p.id = oi.product_id
         WHERE o.status = 'paid' AND o.created_at >= $1::date
           AND o.created_at < $2::date + INTERVAL '1 day'
         GROUP BY p.id, p.name, o.currency ORDER BY sales DESC LIMIT 20`,
        params,
      ),
      db.query(
        `SELECT c.name, o.currency, SUM(oi.quantity) AS quantity,
                SUM(oi.line_total) AS sales
         FROM order_items oi JOIN orders o ON o.id = oi.order_id
         JOIN products p ON p.id = oi.product_id
         JOIN categories c ON c.id = p.category_id
         WHERE o.status = 'paid' AND o.created_at >= $1::date
           AND o.created_at < $2::date + INTERVAL '1 day'
         GROUP BY c.id, c.name, o.currency ORDER BY sales DESC`,
        params,
      ),
      db.query(
        `SELECT COALESCE(u.full_name, 'Unknown') AS cashier, o.currency,
                COUNT(*) AS order_count, SUM(o.total) AS sales
         FROM orders o LEFT JOIN users u ON u.id = o.created_by
         WHERE o.status = 'paid' AND o.created_at >= $1::date
           AND o.created_at < $2::date + INTERVAL '1 day'
         GROUP BY u.id, u.full_name, o.currency ORDER BY sales DESC`,
        params,
      ),
      db.query(
        `SELECT p.method, o.currency, SUM(p.amount_paid) AS total
         FROM payments p JOIN orders o ON o.id = p.order_id
         WHERE p.status = 'paid' AND o.created_at >= $1::date
           AND o.created_at < $2::date + INTERVAL '1 day'
         GROUP BY p.method, o.currency ORDER BY total DESC`,
        params,
      ),
      db.query(
        `SELECT p.name, o.currency,
                SUM(oi.line_total) AS sales,
                SUM(oi.unit_cost * oi.quantity) AS cost,
                SUM(oi.line_total - oi.unit_cost * oi.quantity) AS profit
         FROM order_items oi JOIN orders o ON o.id = oi.order_id
         JOIN products p ON p.id = oi.product_id
         WHERE o.status = 'paid' AND o.created_at >= $1::date
           AND o.created_at < $2::date + INTERVAL '1 day'
         GROUP BY p.id, p.name, o.currency ORDER BY profit DESC LIMIT 20`,
        params,
      ),
    ]);
    return NextResponse.json({
      sales: sales.rows,
      expenses: expenses.rows,
      products: products.rows,
      categories: categories.rows,
      cashiers: cashiers.rows,
      payments: payments.rows,
      profit: profit.rows,
    });
  } catch (error) {
    console.error("Could not load reports.", error);
    return NextResponse.json({ error: "Could not load reports." }, { status: 500 });
  }
}
