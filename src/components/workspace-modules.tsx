"use client";

import { FormEvent, useMemo, useRef, useState } from "react";

export type WorkspaceModule =
  | "product" | "category" | "inventory" | "supplier" | "purchase"
  | "tables" | "expense" | "users" | "settings" | "invoice" | "audit";

type Row = Record<string, unknown>;
type AuditQuery = { action: string; entity: string; user: string; from: string; to: string; page: number };
type Option = { id: number; name: string; permissions?: string[] };
type Permission = { key: string; label: string };
type Props = {
  module: WorkspaceModule;
  rows: Row[];
  extras: Record<string, unknown>;
  canManage: boolean;
  busy: boolean;
  onSave: (module: WorkspaceModule, values: Row, id?: number) => Promise<void>;
  onFinalizePurchase?: (id: number) => Promise<void>;
  canPayInvoices?: boolean;
  canAddInvoiceItems?: boolean;
  canDeleteInvoices?: boolean;
  onPayInvoice?: (row: Row) => void;
  onAddInvoiceItem?: (orderId: number, productId: number, quantity: number) => Promise<void>;
  onDeleteInvoice?: (row: Row) => Promise<void>;
  onAuditQuery?: (query: AuditQuery) => Promise<void>;
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
  users: ["username", "full_name", "role_name", "privilege_summary", "is_active", "last_login"],
  settings: ["key", "value"],
  invoice: ["invoice_number", "order_number", "customer_name", "table_name", "issued_at", "total", "remaining_due", "currency", "status", "cashier"],
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
  order_number: "Order", customer_name: "Customer", issued_at: "Issued", total: "Total", remaining_due: "Balance due", cashier: "Cashier",
  action: "Action", entity_type: "Entity", entity_id: "Record", details: "Details",
  privilege_summary: "Privileges",
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
      ...(!editing ? [{ key: "username", label: "Username", required: true }] : []),
      { key: "fullName", label: "Full name", required: true },
      { key: "roleId", label: "Role", type: "select", required: true, options: options(extras, "roles") },
      ...(!editing ? [{ key: "pin", label: "Temporary PIN (4–32 digits)", type: "password" as const, required: true }] : []),
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

function localDate(offsetDays = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export default function WorkspaceModules({ module, rows, extras, canManage, busy, onSave, onFinalizePurchase, canPayInvoices, canAddInvoiceItems, canDeleteInvoices, onPayInvoice, onAddInvoiceItem, onDeleteInvoice, onAuditQuery, onRefresh }: Props) {
  const [values, setValues] = useState<Row>({});
  const [editing, setEditing] = useState<number | undefined>();
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [invoiceProducts, setInvoiceProducts] = useState<Record<string, string>>({});
  const [auditAction, setAuditAction] = useState("");
  const [auditEntity, setAuditEntity] = useState("");
  const [auditUser, setAuditUser] = useState("");
  const [auditFrom, setAuditFrom] = useState(() => localDate(-29));
  const [auditTo, setAuditTo] = useState(() => localDate());
  const [auditPreset, setAuditPreset] = useState("30");
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
      if (field.key === "roleId" && module === "users") {
        mapped.roleId = String(row.role_id ?? "");
        continue;
      }
      const key = source[field.key] ?? field.key;
      mapped[field.key] = row[key] == null ? "" : String(row[key]);
    }
    if (module === "users") {
      const customized = row.permissions_customized === true;
      const roles = options(extras, "roles");
      const selectedRole = roles.find((role) => Number(role.id) === Number(row.role_id));
      mapped.customPermissions = customized;
      mapped.permissions = customized
        ? Array.isArray(row.permissions) ? row.permissions : []
        : selectedRole?.permissions ?? [];
      mapped.active = row.is_active !== false;
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

  async function queryAudit(page = 1) {
    try {
      await onAuditQuery?.({
        action: auditAction,
        entity: auditEntity,
        user: auditUser,
        from: auditFrom,
        to: auditTo,
        page,
      });
    } catch {
      return;
    }
  }

  function changeAuditPreset(preset: string) {
    setAuditPreset(preset);
    if (preset !== "custom") {
      const days = Number(preset);
      setAuditFrom(localDate(1 - days));
      setAuditTo(localDate());
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

  if (module === "audit") {
    const metrics = (extras.metrics ?? {}) as Record<string, unknown>;
    const pagination = (extras.pagination ?? {}) as Record<string, unknown>;
    const actions = Array.isArray(extras.actions) ? extras.actions as string[] : [];
    const entities = Array.isArray(extras.entities) ? extras.entities as string[] : [];
    const users = Array.isArray(extras.users) ? extras.users as string[] : [];
    const page = Number(pagination.page ?? 1);
    const pageSize = Number(pagination.pageSize ?? 8);
    const total = Number(pagination.total ?? 0);
    const pageCount = Math.max(1, Number(pagination.pageCount ?? 1));
    const firstRecord = total ? (page - 1) * pageSize + 1 : 0;
    const lastRecord = Math.min(page * pageSize, total);
    const firstPage = Math.max(1, Math.min(page - 2, pageCount - 4));
    const pageNumbers = Array.from({ length: Math.min(5, pageCount) }, (_, index) => firstPage + index);
    return <section className="audit-page">
      <header className="audit-header">
        <div className="audit-title-group"><span className="audit-history-icon">◴</span><div><h2>Audit Log</h2><p>Track all system activities and changes</p></div></div>
        <div className="audit-header-controls"><label className="audit-period"><span>▦</span><select aria-label="Audit log date period" value={auditPreset} onChange={(event) => changeAuditPreset(event.target.value)}><option value="30">Last 30 Days</option><option value="7">Last 7 Days</option><option value="90">Last 90 Days</option><option value="custom">Custom Range</option></select></label><button className="audit-refresh" onClick={() => void queryAudit(page)}>⟳ <span>Refresh</span></button></div>
      </header>

      <div className="audit-metrics">
        <article className="audit-metric"><span className="audit-metric-icon blue">♙</span><div><strong>{Number(metrics.total ?? 0).toLocaleString()}</strong><small>Total Actions</small></div></article>
        <article className="audit-metric"><span className="audit-metric-icon green">✓</span><div><strong>{Number(metrics.successful ?? 0).toLocaleString()}</strong><small>Successful Actions</small></div></article>
        <article className="audit-metric"><span className="audit-metric-icon purple">⚙</span><div><strong>{Number(metrics.systemOperations ?? 0).toLocaleString()}</strong><small>System Operations</small></div></article>
        <article className="audit-metric"><span className="audit-metric-icon orange">▥</span><div><strong>{Number(metrics.trackedPercent ?? 0)}%</strong><small>Activity Tracked</small></div></article>
      </div>

      <form className="audit-filter-bar" onSubmit={(event) => { event.preventDefault(); void queryAudit(1); }}>
        <label>Action Type<select value={auditAction} onChange={(event) => setAuditAction(event.target.value)}><option value="">All Actions</option>{actions.map((action) => <option key={action} value={action}>{action.charAt(0).toUpperCase() + action.slice(1)}</option>)}</select></label>
        <label>Entity<select value={auditEntity} onChange={(event) => setAuditEntity(event.target.value)}><option value="">All Entities</option>{entities.map((entity) => <option key={entity} value={entity}>{entity.replaceAll("_", " ")}</option>)}</select></label>
        <label>User<select value={auditUser} onChange={(event) => setAuditUser(event.target.value)}><option value="">All Users</option>{users.map((username) => <option key={username} value={username}>{username}</option>)}</select></label>
        <label className="audit-range-label">Date Range<div className="audit-date-range"><span>▦</span><input aria-label="Start date" type="date" value={auditFrom} onChange={(event) => { setAuditFrom(event.target.value); setAuditPreset("custom"); }} /><span className="audit-date-separator">–</span><input aria-label="End date" type="date" value={auditTo} onChange={(event) => { setAuditTo(event.target.value); setAuditPreset("custom"); }} /></div></label>
        <button className="audit-search" type="submit"><span>⌕</span> Search</button>
      </form>

      <section className="audit-table-card"><div className="audit-table-scroll"><table className="audit-table">
        <thead><tr><th>#</th><th>Action</th><th>Entity</th><th>Record ID</th><th>User Name</th><th>Created</th><th>Details</th></tr></thead>
        <tbody>{rows.map((row, index) => {
          const action = String(row.action ?? "unknown").toLowerCase();
          const details = typeof row.details === "string" ? row.details : JSON.stringify(row.details ?? {});
          const createdAt = row.created_at ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" }).format(new Date(String(row.created_at))) : "—";
          return <tr key={String(row.id)}>
            <td>{(page - 1) * pageSize + index + 1}</td>
            <td><span className={`audit-action-pill audit-action-${action}`}>{action}</span></td>
            <td>{String(row.entity_type ?? "—")}</td>
            <td>{row.entity_id == null ? "—" : String(row.entity_id)}</td>
            <td className="audit-user-cell">{String(row.username ?? "System")}</td>
            <td className="audit-created-cell">{createdAt}</td>
            <td><code className="audit-details" title={details}>{details}</code></td>
          </tr>;
        })}{!rows.length && <tr><td colSpan={7} className="audit-empty">No activity matches these filters.</td></tr>}</tbody>
      </table></div>
      <footer className="audit-table-footer"><span>Showing {firstRecord}–{lastRecord} of {total.toLocaleString()} records</span><nav className="audit-pagination" aria-label="Audit log pagination">
        <button aria-label="First page" disabled={page <= 1} onClick={() => void queryAudit(1)}>«</button><button aria-label="Previous page" disabled={page <= 1} onClick={() => void queryAudit(page - 1)}>‹</button>
        {pageNumbers.map((number) => <button key={number} aria-current={number === page ? "page" : undefined} className={number === page ? "active" : ""} onClick={() => void queryAudit(number)}>{number}</button>)}
        <button aria-label="Next page" disabled={page >= pageCount} onClick={() => void queryAudit(page + 1)}>›</button><button aria-label="Last page" disabled={page >= pageCount} onClick={() => void queryAudit(pageCount)}>»</button>
      </nav></footer></section>
    </section>;
  }

  if (module === "invoice") {
    const products = options(extras, "products");
    const filteredRows = rows.filter((row) => [row.invoice_number, row.order_number, row.customer_name, row.table_name, row.cashier]
      .some((value) => String(value ?? "").toLowerCase().includes(invoiceSearch.trim().toLowerCase())));
    return <section className="module-page">
      <ModuleHeading moduleName={moduleName} rows={rows} onRefresh={onRefresh} />
      <div className="invoice-search"><label>Find an order or invoice<input value={invoiceSearch} onChange={(event) => setInvoiceSearch(event.target.value)} placeholder="Search order number, invoice, customer, table, or cashier" /></label></div>
      <section className="data-card module-table"><div className="table-scroll"><table>
        <thead><tr>{rowsKey.invoice.map((key) => <th key={key}>{labels[key] ?? key}</th>)}<th>Order actions</th></tr></thead>
        <tbody>{filteredRows.map((row) => {
          const orderId = Number(row.order_id);
          const isOpen = row.status !== "paid" && row.status !== "cancelled" && Number(row.remaining_due) > 0;
          return <tr key={String(row.id)}>
            {rowsKey.invoice.map((key) => <td className={key === "invoice_number" || key === "order_number" ? "cell-strong" : ""} key={key}>{display(row[key])}</td>)}
            <td><div className="invoice-actions">
              {canPayInvoices && isOpen && <button className="primary compact" onClick={() => onPayInvoice?.(row)}>Record payment</button>}
              {isOpen && canAddInvoiceItems && onAddInvoiceItem && <><select aria-label={`Product to add to order ${String(row.order_number)}`} value={invoiceProducts[String(row.id)] ?? ""} onChange={(event) => setInvoiceProducts((current) => ({ ...current, [String(row.id)]: event.target.value }))}><option value="">Add an item…</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select><button className="secondary compact" disabled={busy || !invoiceProducts[String(row.id)]} onClick={() => {
                const productId = Number(invoiceProducts[String(row.id)]);
                void onAddInvoiceItem(orderId, productId, 1).then(() => setInvoiceProducts((current) => ({ ...current, [String(row.id)]: "" }))).catch(() => undefined);
              }}>Add item</button></>}
              {!isOpen && row.status === "paid" && canDeleteInvoices && onDeleteInvoice && Number(row.id) > 0
                ? <button className="invoice-delete-button" disabled={busy} onClick={() => void onDeleteInvoice(row)}>Delete invoice</button>
                : !isOpen && <span>{row.status === "cancelled" ? "Cancelled" : "Settled"}</span>}
            </div></td>
          </tr>;
        })}{!filteredRows.length && <tr><td className="empty-row" colSpan={rowsKey.invoice.length + 1}>{rows.length ? "No orders match your search." : "No invoices or orders yet."}</td></tr>}</tbody>
      </table></div></section>
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
            return <label key={field.key}>{field.label}<select value={value} required={field.required} onChange={(event) => {
              const nextValue = event.target.value;
              if (module === "users" && field.key === "roleId" && values.customPermissions !== true) {
                const role = field.options?.find((option) => String(option.id) === nextValue);
                setValues((current) => ({ ...current, roleId: nextValue, permissions: role?.permissions ?? [] }));
              } else {
                setValues((current) => ({ ...current, [field.key]: nextValue }));
              }
            }}>
              <option value="">Select…</option>{choices.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select></label>;
          }
          if (field.type === "textarea") return <label className="span-all" key={field.key}>{field.label}<textarea value={value} required={field.required} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))} /></label>;
          return <label key={field.key}>{field.label}<input type={field.type ?? "text"} min={field.type === "number" ? "0" : undefined} step={field.type === "number" && ["cost", "price", "amount"].includes(field.key) ? "0.01" : "1"} value={value} required={field.required} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))} /></label>;
        })}</div>
        {module === "users" && <>
          {editing !== undefined && <label className="user-active-toggle">
            <input type="checkbox" checked={values.active !== false} onChange={(event) => setValues((current) => ({ ...current, active: event.target.checked }))} />
            Account active
          </label>}
          <label className="user-active-toggle">
            <input type="checkbox" checked={values.customPermissions === true} onChange={(event) => setValues((current) => ({ ...current, customPermissions: event.target.checked }))} />
            Set custom privileges instead of role defaults
          </label>
          {values.customPermissions === true && <fieldset className="permission-picker">
            <legend>Allowed actions for this user</legend>
            {(Array.isArray(extras.permissions) ? extras.permissions as Permission[] : []).map((permission) => {
              const selected = Array.isArray(values.permissions) ? values.permissions as string[] : [];
              return <label key={permission.key}>
                <input type="checkbox" checked={selected.includes(permission.key)} onChange={(event) => {
                  const next = event.target.checked
                    ? [...selected, permission.key]
                    : selected.filter((item) => item !== permission.key);
                  setValues((current) => ({ ...current, permissions: next }));
                }} />
                {permission.label}
              </label>;
            })}
          </fieldset>}
        </>}
        {module === "product" && typeof values.currentImageUrl === "string" && values.currentImageUrl
          && <div className="current-product-photo"><span>Current photo</span><img src={values.currentImageUrl} alt="Current product" /></div>}
        <div className="form-actions"><button className="primary" disabled={busy}>{busy ? "Saving…" : editing ? "Update" : "Save"}</button><button type="button" className="secondary" onClick={reset}>Clear</button></div>
      </form>}
      <section className="data-card module-table"><RowsTable rows={rows} keys={rowsKey[module]} onEdit={canManage && ["product", "category", "supplier", "tables", "users"].includes(module) ? selectRow : undefined} />
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
