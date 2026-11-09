export type Role = "Admin" | "Manager" | "Cashier" | "Kitchen";

const permissions: Record<Role, ReadonlySet<string>> = {
  Admin: new Set([
    "pos.use", "catalog.read", "catalog.manage", "inventory.read",
    "inventory.manage", "tables.read", "tables.manage", "orders.create",
    "orders.cancel", "payments.record", "kitchen.use", "suppliers.read",
    "suppliers.manage", "purchases.read", "purchases.manage",
    "expenses.read", "expenses.manage", "invoices.view", "reports.view",
    "users.manage", "settings.read", "settings.manage", "audit.read",
    "app.close",
  ]),
  Manager: new Set([
    "pos.use", "catalog.read", "catalog.manage", "inventory.read",
    "inventory.manage", "tables.read", "tables.manage", "orders.create",
    "orders.cancel", "payments.record", "kitchen.use", "suppliers.read",
    "suppliers.manage", "purchases.read", "purchases.manage",
    "expenses.read", "expenses.manage", "invoices.view", "reports.view",
    "settings.read", "audit.read", "app.close",
  ]),
  Cashier: new Set([
    "pos.use", "catalog.read", "tables.read", "orders.create",
    "orders.cancel", "payments.record", "invoices.view",
    "settings.read", "app.close",
  ]),
  Kitchen: new Set(["kitchen.use", "app.close"]),
};

export function can(role: string, permission: string): boolean {
  return role in permissions && permissions[role as Role].has(permission);
}
