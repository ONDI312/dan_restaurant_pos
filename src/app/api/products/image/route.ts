import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { authorize, isResponse, requestJson } from "@/lib/api";
import { db } from "@/lib/db";
import { deleteProductImage, isProductImageKey, uploadProductImage } from "@/lib/product-images";
import { requireSameOrigin } from "@/lib/session";

export const runtime = "nodejs";

const maxImageBytes = 4 * 1024 * 1024;
const formats = {
  "image/jpeg": { extension: "jpg", signature: (bytes: Buffer) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
  "image/png": { extension: "png", signature: (bytes: Buffer) => bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) },
  "image/webp": { extension: "webp", signature: (bytes: Buffer) => bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP" },
} as const;

export async function POST(request: NextRequest) {
  if (!requireSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const user = await authorize(request, "catalog.manage");
  if (isResponse(user)) return user;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Upload a valid image file." }, { status: 400 });
  }
  const file = form.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "Choose an image file." }, { status: 400 });
  }
  if (file.size < 1 || file.size > maxImageBytes) {
    return NextResponse.json({ error: "Product photos must be 4 MB or smaller." }, { status: 413 });
  }
  const format = Object.entries(formats).find(([type]) => type === file.type)?.[1];
  if (!format) {
    return NextResponse.json({ error: "Use a JPEG, PNG, or WebP product photo." }, { status: 415 });
  }

  const body = Buffer.from(await file.arrayBuffer());
  if (!format.signature(body)) {
    return NextResponse.json({ error: "The image file does not match its format." }, { status: 415 });
  }
  const key = `products/${randomUUID()}.${format.extension}`;
  try {
    await uploadProductImage(key, body, file.type);
    return NextResponse.json({ key }, { status: 201 });
  } catch (error) {
    console.error("Could not upload product image.", error);
    return NextResponse.json({ error: "Could not upload product image." }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  if (!requireSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const user = await authorize(request, "catalog.manage");
  if (isResponse(user)) return user;
  const body = await requestJson(request);
  const key = typeof body?.key === "string" ? body.key : "";
  if (!isProductImageKey(key)) return NextResponse.json({ error: "Invalid product image key." }, { status: 400 });

  try {
    const reference = await db.query("SELECT 1 FROM products WHERE image_path = $1 LIMIT 1", [key]);
    if (reference.rowCount) return NextResponse.json({ error: "This image is already in use." }, { status: 409 });
    await deleteProductImage(key);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Could not remove unused product image.", error);
    return NextResponse.json({ error: "Could not remove unused product image." }, { status: 500 });
  }
}
