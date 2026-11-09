"use client";

import { FormEvent, useMemo, useRef, useState } from "react";

export type WorkspaceModule =
  | "product" | "category" | "inventory" | "supplier" | "purchase"
  | "tables" | "expense" | "users" | "settings" | "invoice" | "audit";

type Row = Record<string, unknown>;
type Option = { id: number; name: string };
type Props = {
  module: WorkspaceModule;
  rows: Row[];
  extras: Record<string, unknown>;
  canManage: boolean;
  busy: boolean;
  onSave: (module: WorkspaceModule, values: Row, id?: number) => Promise<void>;
  onFinalizePurchase?: (id: number) => Promise<void>;
  onRefresh: () => void;
};

type Field = {
  key: string;
  label: string;
  type?: "select" | "textarea" | "date" | "number" | "email" | "url" | "password" | "file";
  required?: boolean;
  options?: Option[];
  choices?: { value: string; label: string }[];
};

const names: Record<WorkspaceModule, string> = {
  product: "Products",
  category: "Categories",
  inventory: "Inventory",
  supplier: "Suppliers",
  purchase: "Purchases",
  tables: "Tables",
  expense: "Expenses",
  users: "Users",
  settings: "Settings",
  invoice: "Invoice list",
  audit: "Audit log",
};

const rowsKey: Record<WorkspaceModule, string[]> = {
  product: ["barcode", "name", "category_name", "cost_price", "price", "stock_quantity", "expires_on", "is_available"],
  category: ["name", "created_at"],
  inventory: ["name", "category_name", "stock_quantity", "min_stock", "cost_price", "is_available"],
  supplier: ["name", "contact_person", "phone", "email", "address", "is_active"],
  purchase: ["invoice_ref", "supplier_name", "total_amount", "status", "created_at"],
  tables: ["table_name", "capacity", "status", "is_active"],
  expense: ["description", "category", "amount", "currency", "method", "created_at"],
  users: ["username", "full_name", "role_name", "is_active", "last_login"],
  settings: ["key", "value"],
  invoice: ["invoice_number", "order_number", "issued_at", "total", "currency", "status", "cashier"],
  audit: ["action", "entity_type", "entity_id", "username", "created_at", "details"],
};

const labels: Record<string, string> = {
  barcode: "Barcode", name: "Name", category_name: "Category", cost_price: "Purchase price",
  price: "Sale price", stock_quantity: "Available", min_stock: "Reorder at", expires_on: "Expiry",
  is_available: "Available", created_at: "Created", contact_person: "Contact", phone: "Phone",
  email: "Email", address: "Address", invoice_ref: "Supplier invoice", supplier_name: "Supplier",
  total_amount: "Total", status: "Status", capacity: "Seats", table_name: "Table",
  description: "Description", category: "Category", amount: "Amount", currency: "Currency",
  method: "Method", username: "Username", full_name: "Full name", role_name: "Role",
  last_login: "Last sign in", key: "Setting", value: "Value", invoice_number: "Invoice",
  order_number: "Order", issued_at: "Issued", total: "Total", cashier: "Cashier",
  action: "Action", entity_type: "Entity", entity_id: "Record", details: "Details",
};

function options(extras: Record<string, unknown>, key: string): Option[] {
  return Array.isArray(extras[key]) ? extras[key] as Option[] : [];
}

function fieldsFor(module: WorkspaceModule, extras: Record<string, unknown>, editing: boolean): Field[] {
  switch (module) {
    case "product":
      return [
        { key: "barcode", label: "Barcode" },
        { key: "categoryId", label: "Select category", type: "select", required: true, options: options(extras, "categories") },
        { key: "name", label: "Product name", required: true },
        { key: "description", label: "Description", type: "textarea" },
        ...(!editing ? [{ key: "stock", label: "Initial stock", type: "number" as const }] : []),
        { key: "cost", label: "Purchase price", type: "number", required: true },
        { key: "price", label: "Sale price", type: "number", required: true },
        { key: "minimum", label: "Low-stock alert at", type: "number" },
        { key: "expiresOn", label: "Expiry date", type: "date" },
        { key: "photo", label: "Product photo", type: "file" },
      ];
    case "category": return [{ key: "name", label: "Category name", required: true }];
    case "inventory": return [
      { key: "productId", label: "Product", type: "select", required: true, options: options(extras, "products") },
      { key: "type", label: "Movement", type: "select", required: true, choices: [
        { value: "stock_addition", label: "Add stock" }, { value: "stock_deduction", label: "Remove stock" },
        { value: "damage", label: "Damaged stock" }, { value: "adjustment_add", label: "Positive adjustment" },
        { value: "adjustment_deduction", label: "Negative adjustment" },
      ] },
      { key: "quantity", label: "Quantity", type: "number", required: true },
      { key: "reason", label: "Reason", required: true },
    ];
    case "supplier": return [
      { key: "name", label: "Supplier name", required: true }, { key: "contact", label: "Contact person" },
      { key: "phone", label: "Phone" }, { key: "email", label: "Email", type: "email" },
      { key: "address", label: "Address", type: "textarea" },
    ];
    case "purchase": return [
      { key: "supplierId", label: "Supplier", type: "select", required: true, options: options(extras, "suppliers") },
      { key: "invoiceRef", label: "Supplier invoice / reference" },
      { key: "productId", label: "Product", type: "select", required: true, options: options(extras, "products") },
      { key: "quantity", label: "Quantity", type: "number", required: true },
      { key: "cost", label: "Unit purchase price", type: "number", required: true },
    ];
    case "tables": return [
      { key: "name", label: "Table name", required: true },
      { key: "capacity", label: "Seating capacity", type: "number", required: true },
    ];
    case "expense": return [
      { key: "categoryId", label: "Expense category", type: "select", options: options(extras, "categories") },
      { key: "categoryName", label: "Or add a category" },
      { key: "description", label: "Description", required: true },
      { key: "amount", label: "Amount", type: "number", required: true },
      { key: "currency", label: "Currency (ISO)", required: true },
      { key: "method", label: "Payment method" },
    ];
    case "users": return [
      { key: "username", label: "Username", required: true }, { key: "fullName", label: "Full name", required: true },
      { key: "roleId", label: "Role", type: "select", required: true, options: options(extras, "roles") },
      { key: "pin", label: "Temporary PIN (4–32 digits)", type: "password", required: true },
    ];
    default: return [];
  }
}

function display(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export default function WorkspaceModules({ module, rows, extras, canManage, busy, onSave, onFinalizePurchase, onRefresh }: Props) {
  const [values, setValues] = useState<Row>({});
  const [editing, setEditing] = useState<number | undefined>();
  const photoInput = useRef<HTMLInputElement>(null);
  const fields = useMemo(() => fieldsFor(module, extras, editing !== undefined), [module, extras, editing]);
  const moduleName = names[module];

  function reset() { setValues({}); setEditing(undefined); if (photoInput.current) photoInput.current.value = ""; }
  function selectRow(row: Row) {
    setEditing(Number(row.id));
    const mapped: Row = {};
    for (const field of fieldsFor(module, extras, true)) {
      const source: Record<string, string> = {
        categoryId: "category_id", name: module === "tables" ? "table_name" : "name",
        capacity: "capacity", contact: "contact_person", imageUrl: "image_path",
        cost: "cost_price", price: "price", minimum: "min_stock", expiresOn: "expires_on",
        description: "description", barcode: "barcode", fullName: "full_name", roleId: "role_id",
        email: "email", phone: "phone", address: "address",
      };
      const key = source[field.key] ?? field.key;
      mapped[field.key] = row[key] == null ? "" : String(row[key]);
    }
    if (module === "product") mapped.currentImageUrl = String(row.image_url ?? "");
    setValues(mapped);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = { ...values };
    if (module === "expense") payload.currency = String(payload.currency || "USD").toUpperCase();
    try {
      await onSave(module, payload, editing);
      reset();
    } catch {
      return;
    }
  }

  if (module === "settings") {
    const settings = Object.fromEntries(rows.map((row) => [String(row.key), String(row.value ?? "")]));
    const settingFields: Field[] = [
      { key: "restaurant_name", label: "Restaurant name", required: true },
      { key: "phone", label: "Phone" }, { key: "email", label: "Email", type: "email" },
      { key: "address", label: "Address", type: "textarea" },
      { key: "currency", label: "Currency (ISO)", required: true },
      { key: "discount_percentage", label: "Discount (%)", type: "number" },
      { key: "vat_percentage", label: "VAT (%)", type: "number" },
      { key: "service_percentage", label: "Service charge (%)", type: "number" },
      { key: "receipt_footer", label: "Receipt footer", type: "textarea" },
    ];
    return <section className="module-page"><ModuleHeading moduleName={moduleName} rows={rows} onRefresh={onRefresh} />
      {canManage ? <form className="module-form settings-form" onSubmit={(event) => {
        event.preventDefault();
        void onSave("settings", { values: Object.fromEntries(settingFields.map((field) => [field.key, values[field.key] ?? settings[field.key] ?? ""])) }).catch(() => undefined);
      }}>
        <div className="module-form-grid">{settingFields.map((field) => <label key={field.key}>{field.label}
          {field.type === "textarea" ? <textarea value={String(values[field.key] ?? settings[field.key] ?? "")} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))} />
            : <input type={field.type ?? "text"} value={String(values[field.key] ?? settings[field.key] ?? "")} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))} required={field.required} />}
        </label>)}</div><button className="primary" disabled={busy}>Save settings</button>
      </form> : <p className="empty-state">You can view settings but do not have permission to change them.</p>}
      <RowsTable rows={rows} keys={rowsKey[module]} />
    </section>;
  }

  return <section className="module-page">
    <ModuleHeading moduleName={moduleName} rows={rows} onRefresh={onRefresh} />
    <div className={canManage && fields.length ? "module-split" : ""}>
      {canManage && fields.length > 0 && <form className="module-form" onSubmit={submit}>
        <div className="section-heading"><div><h2>{editing ? `Edit ${moduleName.slice(0, -1)}` : `Add ${moduleName.slice(0, -1)}`}</h2><p>Changes are saved to the Neon database.</p></div>
          {editing !== undefined && <button className="secondary" type="button" onClick={reset}>New</button>}</div>
        <div className="module-form-grid">{fields.map((field) => {
          const value = String(values[field.key] ?? "");
          if (field.type === "file") return <label key={field.key}>{field.label}
            <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => {
              const file = event.target.files?.[0];
              setValues((current) => ({ ...current, [field.key]: file }));
            }} />
            {values.photo instanceof File && <small>{values.photo.name}</small>}
          </label>;
          if (field.type === "select") {
            const choices = field.choices ?? field.options?.map((option) => ({ value: String(option.id), label: option.name })) ?? [];
            return <label key={field.key}>{field.label}<select value={value} required={field.required} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}>
              <option value="">Select…</option>{choices.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select></label>;
          }
          if (field.type === "textarea") return <label className="span-all" key={field.key}>{field.label}<textarea value={value} required={field.required} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))} /></label>;
          return <label key={field.key}>{field.label}<input type={field.type ?? "text"} min={field.type === "number" ? "0" : undefined} step={field.type === "number" && ["cost", "price", "amount"].includes(field.key) ? "0.01" : "1"} value={value} required={field.required} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))} /></label>;
        })}</div>
        {module === "product" && typeof values.currentImageUrl === "string" && values.currentImageUrl
          && <div className="current-product-photo"><span>Current photo</span><img src={values.currentImageUrl} alt="Current product" /></div>}
        <div className="form-actions"><button className="primary" disabled={busy}>{busy ? "Saving…" : editing ? "Update" : "Save"}</button><button type="button" className="secondary" onClick={reset}>Clear</button></div>
      </form>}
      <section className="data-card module-table"><RowsTable rows={rows} keys={rowsKey[module]} onEdit={canManage && ["product", "category", "supplier", "tables"].includes(module) ? selectRow : undefined} />
        {module === "purchase" && <div className="module-hint">New purchases are saved as drafts. Finalize them to receive stock into inventory.</div>}
        {module === "purchase" && onFinalizePurchase && <div className="purchase-actions">{rows.filter((row) => row.status === "draft").map((row) => <button key={String(row.id)} className="secondary compact" disabled={busy} onClick={() => void onFinalizePurchase(Number(row.id))}>Receive purchase #{String(row.id)}</button>)}</div>}
      </section>
    </div>
  </section>;
}

function ModuleHeading({ moduleName, rows, onRefresh }: { moduleName: string; rows: Row[]; onRefresh: () => void }) {
  return <div className="section-heading module-heading"><div><h2>{moduleName}</h2><p>{rows.length} records · Live from Neon</p></div><button className="secondary" onClick={onRefresh}>↻ Refresh</button></div>;
}

function RowsTable({ rows, keys, onEdit }: { rows: Row[]; keys: string[]; onEdit?: (row: Row) => void }) {
  return <div className="table-scroll"><table><thead><tr>{keys.map((key) => <th key={key}>{labels[key] ?? key}</th>)}{onEdit && <th>Action</th>}</tr></thead><tbody>
    {rows.map((row, index) => <tr key={String(row.id ?? row.key ?? index)}>{keys.map((key) => <td className={key === "name" || key === "invoice_number" ? "cell-strong" : ""} key={key}>{display(row[key])}</td>)}{onEdit && <td><button className="secondary compact" onClick={() => onEdit(row)}>Edit</button></td>}</tr>)}
    {!rows.length && <tr><td className="empty-row" colSpan={keys.length + (onEdit ? 1 : 0)}>No records yet.</td></tr>}
  </tbody></table></div>;
}
