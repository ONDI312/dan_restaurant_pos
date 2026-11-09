import { NextRequest, NextResponse } from "next/server";
import { authorize, isResponse } from "@/lib/api";
import { db } from "@/lib/db";
import { resolveProductImage } from "@/lib/product-images";

export async function GET(request: NextRequest) {
  const user = await authorize(request, "catalog.read");
  if (isResponse(user)) return user;
  const term = request.nextUrl.searchParams.get("q")?.trim().slice(0, 80) ?? "";
  const categoryId = request.nextUrl.searchParams.get("category");
  if (categoryId && !/^\d+$/.test(categoryId)) {
    return NextResponse.json({ error: "Invalid category." }, { status: 400 });
  }
  try {
    const result = await db.query(
      `SELECT p.id, p.name, p.barcode, p.price, p.stock_quantity, p.min_stock, p.image_path,
              p.category_id, c.name AS category_name
       FROM products p JOIN categories c ON c.id = p.category_id
       WHERE p.is_available = TRUE AND p.stock_quantity > 0
         AND ($1 = '' OR p.name ILIKE $2 OR COALESCE(p.barcode, '') ILIKE $2)
         AND ($3::bigint IS NULL OR p.category_id = $3)
       ORDER BY p.name LIMIT 100`,
      [term, `%${term}%`, categoryId || null],
    );
    const products = await Promise.all(result.rows.map(async (product) => {
      const id = Number(product.id);
      if (!Number.isSafeInteger(id) || id <= 0) {
        throw new Error("Product ID cannot be represented safely by the POS.");
      }
      return {
        ...product,
        id,
        category_id: Number(product.category_id),
        image_path: await resolveProductImage(product.image_path),
      };
    }));
    return NextResponse.json({ products });
  } catch (error) {
    console.error("Could not load products.", error);
    return NextResponse.json({ error: "Could not load products." }, { status: 500 });
  }
}
