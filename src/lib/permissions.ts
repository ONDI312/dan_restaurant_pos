export type Role = "Admin" | "Manager" | "Cashier" | "Kitchen";

export const permissionCatalog = [
  { key: "pos.use", label: "Use point of sale" },
  { key: "catalog.read", label: "View products and categories" },
  { key: "catalog.manage", label: "Manage products and categories" },
  { key: "inventory.read", label: "View inventory" },
  { key: "inventory.manage", label: "Adjust inventory" },
  { key: "tables.read", label: "View tables" },
  { key: "tables.manage", label: "Manage tables" },
  { key: "orders.create", label: "Create orders" },
  { key: "orders.cancel", label: "Cancel orders" },
  { key: "payments.record", label: "Record payments" },
  { key: "kitchen.use", label: "Use kitchen display" },
  { key: "suppliers.read", label: "View suppliers" },
  { key: "suppliers.manage", label: "Manage suppliers" },
  { key: "purchases.read", label: "View purchases" },
  { key: "purchases.manage", label: "Manage purchases" },
  { key: "expenses.read", label: "View expenses" },
  { key: "expenses.manage", label: "Manage expenses" },
  { key: "invoices.view", label: "View invoices" },
  { key: "reports.view", label: "View reports and dashboard" },
  { key: "users.manage", label: "Manage users and privileges" },
  { key: "settings.read", label: "View settings" },
  { key: "settings.manage", label: "Manage settings" },
  { key: "audit.read", label: "View audit log" },
  { key: "app.close", label: "Close application" },
] as const;

const rolePermissions: Record<Role, ReadonlySet<string>> = {
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

export function permissionsForRole(role: string): string[] {
  return role in rolePermissions ? [...rolePermissions[role as Role]] : [];
}

export function can(role: string, permission: string, customPermissions?: readonly string[]): boolean {
  if (customPermissions !== undefined) return customPermissions.includes(permission);
  return role in rolePermissions && rolePermissions[role as Role].has(permission);
}
