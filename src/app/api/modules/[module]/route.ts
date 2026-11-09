import argon2 from "argon2";
import { NextRequest, NextResponse } from "next/server";
import { authorize, isResponse, requestJson, validationError } from "@/lib/api";
import { db } from "@/lib/db";
import { deleteProductImage, isProductImageKey, resolveProductImage } from "@/lib/product-images";
import { can, permissionCatalog, permissionsForRole } from "@/lib/permissions";
import { requireSameOrigin } from "@/lib/session";

type Context = { params: Promise<{ module: string }> };
type Body = Record<string, unknown>;

const access: Record<string, { read: string; write?: string }> = {
  products: { read: "catalog.read", write: "catalog.manage" },
  categories: { read: "catalog.read", write: "catalog.manage" },
  inventory: { read: "inventory.read", write: "inventory.manage" },
  suppliers: { read: "suppliers.read", write: "suppliers.manage" },
  purchases: { read: "purchases.read", write: "purchases.manage" },
  tables: { read: "tables.read", write: "tables.manage" },
  expenses: { read: "expenses.read", write: "expenses.manage" },
  users: { read: "users.manage", write: "users.manage" },
  settings: { read: "settings.read", write: "settings.manage" },
  invoices: { read: "invoices.view" },
  audit: { read: "audit.read" },
};

function text(body: Body, key: string, required = false, max = 500): string {
  const value = typeof body[key] === "string" ? body[key].trim() : "";
  if (required && !value) throw validationError(`${key} is required.`);
  if (value.length > max) throw validationError(`${key} is too long.`);
  return value;
}

function integer(body: Body, key: string, min = 0): number {
  const value = body[key];
  const parsed = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed < min) {
    throw validationError(`${key} must be a whole number of at least ${min}.`);
  }
  return parsed;
}

function decimal(body: Body, key: string, min = 0): string {
  const value = Number(body[key]);
  if (!Number.isFinite(value) || value < min || value > 9_999_999_999.99) {
    throw validationError(`${key} must be a valid amount.`);
  }
  return value.toFixed(2);
}

function validDate(value: string): boolean {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function validImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function userPermissions(body: Body): { customized: boolean; permissions: string[] } {
  if (body.customPermissions !== true) return { customized: false, permissions: [] };
  if (!Array.isArray(body.permissions) || body.permissions.some((value) => typeof value !== "string")) {
    throw validationError("Choose valid user privileges.");
  }
  const allowed = new Set<string>(permissionCatalog.map((permission) => permission.key));
  const permissions = [...new Set(body.permissions as string[])];
  if (permissions.some((permission) => !allowed.has(permission))) {
    throw validationError("One or more selected privileges are invalid.");
  }
  return { customized: true, permissions };
}

function canAssignRole(actor: { role: string; permissions?: string[] }, assigned: string[]) {
  const actorPermissions = actor.permissions ?? permissionsForRole(actor.role);
  return assigned.every((permission) => can(actor.role, permission, actorPermissions));
}

async function writeAudit(userId: number, action: string, entity: string, id: number | string, details: object) {
  await db.query(
    "INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5)",
    [userId, action, entity, String(id), JSON.stringify(details)],
  );
}

export async function GET(request: NextRequest, context: Context) {
  const { module } = await context.params;
  const permission = access[module]?.read;
  if (!permission) return NextResponse.json({ error: "Unknown module." }, { status: 404 });
  const user = await authorize(request, permission);
  if (isResponse(user)) return user;
  try {
    let rows;
    const extras: Record<string, unknown> = {};
    switch (module) {
      case "products":
        rows = (await db.query(
          `SELECT p.id, p.barcode, p.name, p.description, p.category_id, c.name AS category_name,
                  p.cost_price, p.price, p.stock_quantity, p.min_stock, p.expires_on,
                  p.image_path, p.is_available
           FROM products p JOIN categories c ON c.id = p.category_id ORDER BY p.name`,
        )).rows;
        rows = await Promise.all(rows.map(async (row) => ({
          ...row,
          image_url: await resolveProductImage(row.image_path),
        })));
        break;
      case "categories":
        rows = (await db.query("SELECT id, name, image_path, created_at FROM categories ORDER BY name")).rows;
        break;
      case "inventory":
        rows = (await db.query(
          `SELECT p.id, p.name, p.barcode, c.name AS category_name, p.stock_quantity, p.min_stock,
                  p.cost_price, p.is_available
           FROM products p JOIN categories c ON c.id = p.category_id ORDER BY p.name`,
        )).rows;
        break;
      case "suppliers":
        rows = (await db.query(
          "SELECT id, name, contact_person, phone, email, address, is_active FROM suppliers ORDER BY name",
        )).rows;
        break;
      case "purchases":
        rows = (await db.query(
          `SELECT p.id, p.invoice_ref, p.total_amount, p.status, p.created_at, s.name AS supplier_name,
                  COALESCE(json_agg(json_build_object(
                    'product', pr.name, 'quantity', pi.quantity, 'unit_cost', pi.unit_cost
                  )) FILTER (WHERE pi.id IS NOT NULL), '[]') AS items
           FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id
           LEFT JOIN purchase_items pi ON pi.purchase_id = p.id
           LEFT JOIN products pr ON pr.id = pi.product_id
           GROUP BY p.id, s.name ORDER BY p.created_at DESC LIMIT 200`,
        )).rows;
        break;
      case "tables":
        rows = (await db.query(
          "SELECT id, table_name, capacity, status, is_active FROM restaurant_tables ORDER BY table_name",
        )).rows;
        break;
      case "expenses":
        rows = (await db.query(
          `SELECT e.id, e.description, e.amount, e.currency, e.method, e.created_at,
                  c.name AS category, e.category_id
           FROM expenses e LEFT JOIN expense_categories c ON c.id = e.category_id
           ORDER BY e.created_at DESC LIMIT 500`,
        )).rows;
        break;
      case "users":
        rows = (await db.query(
          `SELECT u.id, u.username, u.full_name, u.role_id, r.name AS role_name,
                  u.is_active, u.permissions_customized, u.last_login,
                  COALESCE(array_agg(up.permission_name) FILTER (WHERE up.permission_name IS NOT NULL), '{}') AS permissions,
                  CASE WHEN u.permissions_customized
                    THEN COALESCE(string_agg(up.permission_name, ', ' ORDER BY up.permission_name), 'No privileges')
                    ELSE 'Role defaults' END AS privilege_summary
           FROM users u JOIN roles r ON r.id = u.role_id
           LEFT JOIN user_permissions up ON up.user_id = u.id
           GROUP BY u.id, r.name ORDER BY u.username`,
        )).rows;
        break;
      case "settings":
        rows = (await db.query("SELECT key, value FROM settings ORDER BY key")).rows;
        break;
      case "invoices":
        rows = (await db.query(
          `SELECT COALESCE(i.id, -o.id) AS id, COALESCE(i.invoice_number, 'INV-' || o.order_number) AS invoice_number,
                  COALESCE(i.issued_at, o.created_at) AS issued_at, o.id AS order_id, o.order_number,
                  o.order_type, o.customer_name, t.table_name, o.total, o.currency, o.status,
                  u.full_name AS cashier,
                  GREATEST(o.total - COALESCE((SELECT SUM(p.amount_paid) FROM payments p
                    WHERE p.order_id = o.id AND p.status = 'paid'), 0), 0) AS remaining_due
           FROM orders o LEFT JOIN invoices i ON i.order_id = o.id
           LEFT JOIN users u ON u.id = o.created_by
           LEFT JOIN restaurant_tables t ON t.id = o.table_id
           WHERE o.status != 'cancelled'
           ORDER BY CASE WHEN o.status = 'paid' THEN 1 ELSE 0 END,
                    COALESCE(i.issued_at, o.created_at) DESC LIMIT 500`,
        )).rows;
        extras.products = (await db.query("SELECT id, name FROM products WHERE is_available = TRUE ORDER BY name")).rows;
        break;
      case "audit":
        rows = (await db.query(
          `SELECT a.id, a.action, a.entity_type, a.entity_id, a.details, a.created_at,
                  u.username FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
           ORDER BY a.created_at DESC LIMIT 500`,
        )).rows;
        break;
    }
    if (module === "products") extras.categories = (await db.query("SELECT id, name FROM categories ORDER BY name")).rows;
    if (module === "inventory") extras.products = (await db.query("SELECT id, name FROM products WHERE is_available = TRUE ORDER BY name")).rows;
    if (module === "purchases") extras.suppliers = (await db.query("SELECT id, name FROM suppliers WHERE is_active = TRUE ORDER BY name")).rows;
    if (module === "purchases") extras.products = (await db.query("SELECT id, name, cost_price, stock_quantity FROM products WHERE is_available = TRUE ORDER BY name")).rows;
    if (module === "expenses") extras.categories = (await db.query("SELECT id, name FROM expense_categories ORDER BY name")).rows;
    if (module === "users") {
      const roles = (await db.query<{ id: number; name: string }>("SELECT id, name FROM roles ORDER BY name")).rows;
      extras.roles = roles.map((role) => ({ ...role, permissions: permissionsForRole(role.name) }));
      extras.permissions = permissionCatalog;
    }
    return NextResponse.json({ rows: rows ?? [], ...extras });
  } catch (error) {
    console.error(`Could not load ${module} module.`, error);
    return NextResponse.json({ error: `Could not load ${module}.` }, { status: 500 });
  }
}

export async function POST(request: NextRequest, context: Context) {
  if (!requireSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const { module } = await context.params;
  const permission = access[module]?.write;
  if (!permission) return NextResponse.json({ error: "This module is read-only." }, { status: 403 });
  const user = await authorize(request, permission);
  if (isResponse(user)) return user;
  const body = await requestJson(request);
  if (!body) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  try {
    switch (module) {
      case "products": {
        const name = text(body, "name", true, 120);
        const categoryId = integer(body, "categoryId", 1);
        const barcode = text(body, "barcode", false, 80) || null;
        const description = text(body, "description", false, 2000);
        const quantity = integer(body, "stock", 0);
        const minimum = integer(body, "minimum", 0);
        const cost = decimal(body, "cost");
        const price = decimal(body, "price", 0.01);
        const expiresOn = text(body, "expiresOn", false, 10) || null;
        const imageKey = text(body, "imageKey", false, 100);
        const imageUrl = text(body, "imageUrl", false, 2000);
        if (imageKey && !isProductImageKey(imageKey)) throw validationError("Product image key is invalid.");
        if (imageUrl && !validImageUrl(imageUrl)) throw validationError("Product image must be an HTTP(S) URL.");
        const imagePath = imageKey || imageUrl || null;
        if (expiresOn && (!/^\d{4}-\d{2}-\d{2}$/.test(expiresOn) || !validDate(expiresOn))) {
          throw validationError("Expiry date must be a valid date.");
        }
        const client = await db.connect();
        try {
          await client.query("BEGIN");
          const created = await client.query<{ id: string }>(
            `INSERT INTO products
             (category_id, name, description, barcode, price, cost_price, stock_quantity, min_stock, expires_on, image_path)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
            [categoryId, name, description, barcode, price, cost, quantity, minimum, expiresOn, imagePath],
          );
          const id = created.rows[0].id;
          if (quantity > 0) await client.query(
            `INSERT INTO inventory_movements (product_id, quantity, movement_type, reason, user_id)
             VALUES ($1, $2, 'stock_addition', 'Initial stock', $3)`,
            [id, quantity, user.id],
          );
          await client.query(
            "INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details) VALUES ($1, 'create', 'product', $2, $3)",
            [user.id, id, JSON.stringify({ name, initialStock: quantity })],
          );
          await client.query("COMMIT");
          return NextResponse.json({ id }, { status: 201 });
        } catch (error) { await client.query("ROLLBACK"); throw error; }
        finally { client.release(); }
      }
      case "categories": {
        const name = text(body, "name", true, 100);
        const result = await db.query<{ id: number }>(
          "INSERT INTO categories (name) VALUES ($1) RETURNING id", [name],
        );
        await writeAudit(user.id, "create", "category", result.rows[0].id, { name });
        return NextResponse.json({ id: result.rows[0].id }, { status: 201 });
      }
      case "inventory": {
        const productId = integer(body, "productId", 1);
        const quantity = integer(body, "quantity", 1);
        const type = text(body, "type", true, 40);
        const reason = text(body, "reason", true, 250);
        const additions = ["stock_addition", "purchase", "adjustment_add"];
        const deductions = ["stock_deduction", "damage", "adjustment_deduction"];
        if (![...additions, ...deductions].includes(type)) throw validationError("Choose a supported stock movement.");
        const client = await db.connect();
        try {
          await client.query("BEGIN");
          const adjustment = additions.includes(type) ? quantity : -quantity;
          const updated = await client.query(
            "UPDATE products SET stock_quantity = stock_quantity + $1 WHERE id = $2 AND stock_quantity + $1 >= 0",
            [adjustment, productId],
          );
          if (updated.rowCount !== 1) throw validationError("Product not found or stock cannot go below zero.");
          await client.query(
            "INSERT INTO inventory_movements (product_id, quantity, movement_type, reason, user_id) VALUES ($1, $2, $3, $4, $5)",
            [productId, quantity, type, reason, user.id],
          );
          await client.query(
            "INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details) VALUES ($1, 'adjust', 'inventory', $2, $3)",
            [user.id, productId, JSON.stringify({ quantity, type, reason })],
          );
          await client.query("COMMIT");
          return NextResponse.json({ ok: true });
        } catch (error) { await client.query("ROLLBACK"); throw error; }
        finally { client.release(); }
      }
      case "suppliers": {
        const name = text(body, "name", true, 120);
        const result = await db.query<{ id: number }>(
          `INSERT INTO suppliers (name, contact_person, phone, email, address)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [name, text(body, "contact", false, 120) || null, text(body, "phone", false, 80) || null,
            text(body, "email", false, 254) || null, text(body, "address", false, 500) || null],
        );
        await writeAudit(user.id, "create", "supplier", result.rows[0].id, { name });
        return NextResponse.json({ id: result.rows[0].id }, { status: 201 });
      }
      case "tables": {
        const name = text(body, "name", true, 80);
        const capacity = integer(body, "capacity", 1);
        const result = await db.query<{ id: number }>(
          "INSERT INTO restaurant_tables (table_name, capacity) VALUES ($1, $2) RETURNING id", [name, capacity],
        );
        await writeAudit(user.id, "create", "table", result.rows[0].id, { name, capacity });
        return NextResponse.json({ id: result.rows[0].id }, { status: 201 });
      }
      case "expenses": {
        let categoryId: number;
        if (body.categoryId) {
          categoryId = integer(body, "categoryId", 1);
        } else {
          const categoryName = text(body, "categoryName", true, 100);
          const category = await db.query<{ id: number }>(
            `INSERT INTO expense_categories (name) VALUES ($1)
             ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
            [categoryName],
          );
          categoryId = category.rows[0].id;
        }
        const description = text(body, "description", true, 500);
        const amount = decimal(body, "amount", 0.01);
        const method = text(body, "method", false, 40);
        const currency = text(body, "currency", true, 3).toUpperCase();
        if (!/^[A-Z]{3}$/.test(currency)) throw validationError("Currency must be a three-letter code.");
        const result = await db.query<{ id: number }>(
          `INSERT INTO expenses (category_id, description, amount, currency, method, created_by)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [categoryId, description, amount, currency, method || null, user.id],
        );
        await writeAudit(user.id, "create", "expense", result.rows[0].id, { amount, currency });
        return NextResponse.json({ id: result.rows[0].id }, { status: 201 });
      }
      case "purchases": {
        const supplierId = integer(body, "supplierId", 1);
        const invoiceRef = text(body, "invoiceRef", false, 100);
        const items = Array.isArray(body.items)
          ? body.items
          : [{ productId: body.productId, quantity: body.quantity, cost: body.cost }];
        if (!Array.isArray(items) || items.length === 0 || items.length > 100) throw validationError("Add at least one purchase line.");
        const client = await db.connect();
        try {
          await client.query("BEGIN");
          const supplier = await client.query("SELECT id FROM suppliers WHERE id = $1 AND is_active = TRUE", [supplierId]);
          if (!supplier.rowCount) throw validationError("Select an active supplier.");
          const normalized = items.map((item) => {
            if (!item || typeof item !== "object") throw validationError("Invalid purchase line.");
            const line = item as Record<string, unknown>;
            const productId = integer(line, "productId", 1);
            const quantity = integer(line, "quantity", 1);
            const cost = decimal(line, "cost");
            return { productId, quantity, cost, total: (Number(cost) * quantity).toFixed(2) };
          });
          const total = normalized.reduce((sum, item) => sum + Number(item.total), 0).toFixed(2);
          const purchase = await client.query<{ id: string }>(
            "INSERT INTO purchases (supplier_id, invoice_ref, total_amount) VALUES ($1, $2, $3) RETURNING id",
            [supplierId, invoiceRef || null, total],
          );
          for (const item of normalized) await client.query(
            "INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost, line_total) VALUES ($1, $2, $3, $4, $5)",
            [purchase.rows[0].id, item.productId, item.quantity, item.cost, item.total],
          );
          await client.query(
            "INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details) VALUES ($1, 'create', 'purchase', $2, $3)",
            [user.id, purchase.rows[0].id, JSON.stringify({ supplierId, total })],
          );
          await client.query("COMMIT");
          return NextResponse.json({ id: purchase.rows[0].id }, { status: 201 });
        } catch (error) { await client.query("ROLLBACK"); throw error; }
        finally { client.release(); }
      }
      case "settings": {
        const allowed = ["restaurant_name", "phone", "email", "address", "currency",
          "discount_percentage", "vat_percentage", "service_percentage", "receipt_footer"];
        const values = body.values;
        if (!values || typeof values !== "object" || Array.isArray(values)) throw validationError("Settings are required.");
        const entries = Object.entries(values as Record<string, unknown>)
          .filter((entry): entry is [string, string] => allowed.includes(entry[0]) && typeof entry[1] === "string");
        if (!entries.length) throw validationError("No valid settings were provided.");
        const normalizedEntries = entries.map(([key, rawValue]) => {
          const value = rawValue.trim();
          if (key === "currency" && !/^[A-Za-z]{3}$/.test(value)) {
            throw validationError("Currency must be a three-letter code.");
          }
          if (["discount_percentage", "vat_percentage", "service_percentage"].includes(key)) {
            const percentage = Number(value);
            if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
              throw validationError(`${key} must be between 0 and 100.`);
            }
          }
          return [key, value] as const;
        });
        for (const [key, value] of normalizedEntries) {
          await db.query(
          `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
            [key, value],
          );
        }
        await writeAudit(user.id, "update", "settings", "general", { keys: entries.map(([key]) => key) });
        return NextResponse.json({ ok: true });
      }
      case "users": {
        const username = text(body, "username", true, 64);
        const fullName = text(body, "fullName", true, 120);
        const roleId = integer(body, "roleId", 1);
        const pin = text(body, "pin", true, 32);
        const assigned = userPermissions(body);
        if (!/^\d{4,32}$/.test(pin)) throw validationError("PIN must contain 4–32 digits.");
        const role = await db.query<{ name: string }>("SELECT name FROM roles WHERE id = $1", [roleId]);
        if (!role.rows[0]) throw validationError("Choose a valid user role.");
        const effectivePermissions = assigned.customized
          ? assigned.permissions
          : permissionsForRole(role.rows[0].name);
        if (!canAssignRole(user, effectivePermissions)) {
          throw validationError("You cannot assign privileges you do not have.");
        }
        const client = await db.connect();
        try {
          await client.query("BEGIN");
          const result = await client.query<{ id: number }>(
            `INSERT INTO users (username, full_name, role_id, pin_hash, permissions_customized)
             VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [username, fullName, roleId, await argon2.hash(pin), assigned.customized],
          );
          if (assigned.permissions.length) {
            await client.query(
              "INSERT INTO user_permissions (user_id, permission_name) "
              + "SELECT $1, assigned.permission_name FROM unnest($2::text[]) AS assigned(permission_name)",
              [result.rows[0].id, assigned.permissions],
            );
          }
          await client.query(
            "INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details) VALUES ($1, 'create', 'user', $2, $3)",
            [user.id, result.rows[0].id, JSON.stringify({ username, customPermissions: assigned.customized, permissions: assigned.permissions })],
          );
          await client.query("COMMIT");
          return NextResponse.json({ id: result.rows[0].id }, { status: 201 });
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      }
      default:
        return NextResponse.json({ error: "This module is read-only." }, { status: 403 });
    }
  } catch (error) {
    if (error instanceof Error && error.name === "ValidationError") {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error(`Could not save ${module} record.`, error);
    return NextResponse.json({ error: `Could not save ${module} record.` }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: Context) {
  if (!requireSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const { module } = await context.params;
  const permission = access[module]?.write;
  if (!permission) return NextResponse.json({ error: "This module is read-only." }, { status: 403 });
  const user = await authorize(request, permission);
  if (isResponse(user)) return user;
  const body = await requestJson(request);
  if (!body) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  try {
    const id = integer(body, "id", 1);
    if (module === "purchases" && body.action === "finalize") {
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        const purchase = await client.query<{ status: string; invoice_ref: string | null }>(
          "SELECT status, invoice_ref FROM purchases WHERE id = $1 FOR UPDATE", [id],
        );
        if (!purchase.rows[0] || purchase.rows[0].status !== "draft") throw validationError("Only draft purchases can be finalized.");
        const items = await client.query<{ product_id: string; quantity: number }>(
          "SELECT product_id, quantity FROM purchase_items WHERE purchase_id = $1 FOR UPDATE", [id],
        );
        if (!items.rowCount) throw validationError("Purchase has no line items.");
        await client.query("UPDATE purchases SET status = 'finalized' WHERE id = $1", [id]);
        for (const item of items.rows) {
          await client.query("UPDATE products SET stock_quantity = stock_quantity + $1 WHERE id = $2", [item.quantity, item.product_id]);
          await client.query(
            `INSERT INTO inventory_movements
             (product_id, quantity, movement_type, reason, user_id, related_purchase_id)
             VALUES ($1, $2, 'purchase', $3, $4, $5)`,
            [item.product_id, item.quantity, `Purchase ${purchase.rows[0].invoice_ref || id}`, user.id, id],
          );
        }
        await client.query(
          "INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details) VALUES ($1, 'finalize', 'purchase', $2, '{}')",
          [user.id, id],
        );
        await client.query("COMMIT");
        return NextResponse.json({ ok: true });
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    }
    let result;
    switch (module) {
      case "products":
        if (body.imageUrl && !/^https?:\/\//i.test(String(body.imageUrl))) throw validationError("Product image must be an HTTP(S) URL.");
        const expiresOn = text(body, "expiresOn", false, 10);
        if (expiresOn && (!/^\d{4}-\d{2}-\d{2}$/.test(expiresOn) || !validDate(expiresOn))) {
          throw validationError("Expiry date must be a valid date.");
        }
        const imageKey = text(body, "imageKey", false, 100);
        const imageUrl = text(body, "imageUrl", false, 2000);
        if (imageKey && !isProductImageKey(imageKey)) throw validationError("Product image key is invalid.");
        if (imageUrl && !validImageUrl(imageUrl)) throw validationError("Product image must be an HTTP(S) URL.");
        const imagePath = imageKey || imageUrl || null;
        const changesImage = Object.hasOwn(body, "imageKey") || Object.hasOwn(body, "imageUrl");
        const previous = await db.query<{ image_path: string | null }>(
          "SELECT image_path FROM products WHERE id = $1", [id],
        );
        if (!previous.rowCount) return NextResponse.json({ error: "Record was not found." }, { status: 404 });
        const previousImage = previous.rows[0].image_path;
        result = await db.query(
          `UPDATE products SET category_id=$1, name=$2, description=$3, barcode=$4,
             cost_price=$5, price=$6, min_stock=$7, expires_on=$8,
             image_path=CASE WHEN $9 THEN $10 ELSE image_path END, is_available=$11
           WHERE id=$12`,
          [integer(body, "categoryId", 1), text(body, "name", true, 120),
            text(body, "description", false, 2000), text(body, "barcode", false, 80) || null,
            decimal(body, "cost"), decimal(body, "price", 0.01), integer(body, "minimum", 0),
            expiresOn || null, changesImage, imagePath,
            body.available !== false, id],
        );
        if (result.rowCount && changesImage && previousImage && isProductImageKey(previousImage)
          && previousImage !== imagePath) {
          try {
            await deleteProductImage(previousImage);
          } catch (error) {
            console.error("Could not remove the replaced product image.", error);
          }
        }
        break;
      case "categories":
        result = await db.query("UPDATE categories SET name=$1 WHERE id=$2", [text(body, "name", true, 100), id]);
        break;
      case "suppliers":
        result = await db.query(
          `UPDATE suppliers SET name=$1, contact_person=$2, phone=$3, email=$4, address=$5 WHERE id=$6`,
          [text(body, "name", true, 120), text(body, "contact", false, 120) || null,
            text(body, "phone", false, 80) || null, text(body, "email", false, 254) || null,
            text(body, "address", false, 500) || null, id],
        );
        break;
      case "tables":
        result = await db.query(
          "UPDATE restaurant_tables SET table_name=$1, capacity=$2 WHERE id=$3",
          [text(body, "name", true, 80), integer(body, "capacity", 1), id],
        );
        break;
      case "users":
        {
          const assigned = userPermissions(body);
          const roleId = integer(body, "roleId", 1);
          const role = await db.query<{ name: string }>("SELECT name FROM roles WHERE id = $1", [roleId]);
          if (!role.rows[0]) throw validationError("Choose a valid user role.");
          const effectivePermissions = assigned.customized
            ? assigned.permissions
            : permissionsForRole(role.rows[0].name);
          if (!canAssignRole(user, effectivePermissions)) {
            throw validationError("You cannot assign privileges you do not have.");
          }
          if (id === user.id && (body.active === false || !effectivePermissions.includes("users.manage"))) {
            throw validationError("You cannot deactivate yourself or remove your own user-management access.");
          }
          const client = await db.connect();
          try {
            await client.query("BEGIN");
            result = await client.query(
              `UPDATE users SET full_name=$1, role_id=$2, is_active=$3, permissions_customized=$4
               WHERE id=$5`,
              [text(body, "fullName", true, 120), roleId, body.active !== false, assigned.customized, id],
            );
            if (result.rowCount === 1) {
              await client.query("DELETE FROM user_permissions WHERE user_id = $1", [id]);
              if (assigned.permissions.length) {
                await client.query(
                  "INSERT INTO user_permissions (user_id, permission_name) "
                  + "SELECT $1, assigned.permission_name FROM unnest($2::text[]) AS assigned(permission_name)",
                  [id, assigned.permissions],
                );
              }
              await client.query(
                "INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details) VALUES ($1, 'update', 'user', $2, $3)",
                [user.id, id, JSON.stringify({ customPermissions: assigned.customized, permissions: assigned.permissions })],
              );
            }
            await client.query("COMMIT");
          } catch (error) {
            await client.query("ROLLBACK");
            throw error;
          } finally {
            client.release();
          }
        }
        break;
      default:
        return NextResponse.json({ error: "Updates are not available for this module." }, { status: 403 });
    }
    if (result.rowCount !== 1) return NextResponse.json({ error: "Record was not found." }, { status: 404 });
    if (module !== "users") await writeAudit(user.id, "update", module, id, { updated: true });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.name === "ValidationError") {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error(`Could not update ${module} record.`, error);
    return NextResponse.json({ error: `Could not update ${module} record.` }, { status: 500 });
  }
}
