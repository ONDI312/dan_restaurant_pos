import { NextRequest, NextResponse } from "next/server";
import { authorize, isResponse } from "@/lib/api";
import { db } from "@/lib/db";

export async function GET(request: NextRequest) {
  const user = await authorize(request, "pos.use");
  if (isResponse(user)) return user;
  try {
    const [settings, categories, tables] = await Promise.all([
      db.query<{ key: string; value: string }>("SELECT key, value FROM settings"),
      db.query("SELECT id, name FROM categories ORDER BY name"),
      db.query(
        "SELECT id, table_name, capacity, status FROM restaurant_tables "
        + "WHERE is_active = TRUE AND status = 'available' ORDER BY table_name",
      ),
    ]);
    const settingValues = Object.fromEntries(settings.rows.map((row) => [row.key, row.value]));
    return NextResponse.json({
      user,
      settings: {
        restaurantName: settingValues.restaurant_name || "DAN RESTAURANT POS",
        currency: /^[A-Z]{3}$/.test(settingValues.currency || "")
          ? settingValues.currency
          : "USD",
        discount: settingValues.discount_percentage || "0",
        vat: settingValues.vat_percentage || "0",
        service: settingValues.service_percentage || "0",
      },
      categories: categories.rows,
      tables: tables.rows,
    });
  } catch (error) {
    console.error("Could not load POS configuration.", error);
    return NextResponse.json({ error: "Could not load POS configuration." }, { status: 500 });
  }
}
