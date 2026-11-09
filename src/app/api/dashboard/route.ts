import { NextRequest, NextResponse } from "next/server";
import { authorize, isResponse } from "@/lib/api";
import { db } from "@/lib/db";

export async function GET(request: NextRequest) {
  const user = await authorize(request, "reports.view");
  if (isResponse(user)) return user;
  try {
    const [sales, stock, tables] = await Promise.all([
      db.query(
        `SELECT currency, COUNT(*) AS order_count, SUM(total) AS total
         FROM orders
         WHERE status = 'paid' AND created_at >= CURRENT_DATE
         GROUP BY currency ORDER BY currency`,
      ),
      db.query(
        `SELECT id, name, stock_quantity, min_stock
         FROM products WHERE is_available = TRUE AND stock_quantity <= min_stock
         ORDER BY stock_quantity, name LIMIT 8`,
      ),
      db.query(
        `SELECT COUNT(*) FILTER (WHERE status = 'available') AS available,
                COUNT(*) FILTER (WHERE status = 'occupied') AS occupied
         FROM restaurant_tables WHERE is_active = TRUE`,
      ),
    ]);
    return NextResponse.json({
      sales: sales.rows,
      lowStock: stock.rows,
      tables: tables.rows[0] ?? { available: 0, occupied: 0 },
    });
  } catch (error) {
    console.error("Could not load dashboard.", error);
    return NextResponse.json({ error: "Could not load dashboard." }, { status: 500 });
  }
}
