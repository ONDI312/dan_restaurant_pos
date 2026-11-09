"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import WorkspaceModules, { type WorkspaceModule } from "@/components/workspace-modules";

type User = { id: number; username: string; fullName: string; role: string };
type Product = {
  id: number;
  name: string;
  barcode: string | null;
  price: string;
  stock_quantity: number;
  category_id: number;
  category_name: string;
  image_path?: string | null;
};
type Category = { id: number; name: string };
type DiningTable = { id: number; table_name: string; capacity: number };
type Order = {
  id: number;
  order_number: string;
  order_type: string;
  total: string;
  currency: string;
  status: string;
  kitchen_status: string;
  created_at: string;
  customer_name?: string | null;
  table_name: string | null;
  cashier: string | null;
  payment_method: string | null;
  items?: { name: string; quantity: number; special_instructions: string | null }[];
};
type Bootstrap = {
  settings: {
    restaurantName: string;
    currency: string;
    discount: string;
    vat: string;
    service: string;
  };
  categories: Category[];
  tables: DiningTable[];
};
type Dashboard = {
  sales: { currency: string; order_count: number; total: string }[];
  lowStock: { id: number; name: string; stock_quantity: number; min_stock: number }[];
  tables: { available: number; occupied: number };
};
type Report = {
  sales: { currency: string; order_count: number; total: string }[];
  expenses: { currency: string; total: string }[];
  products: { name: string; currency: string; quantity: number; sales: string }[];
  categories: { name: string; currency: string; quantity: number; sales: string }[];
  cashiers: { cashier: string; currency: string; order_count: number; sales: string }[];
  payments: { method: string; currency: string; total: string }[];
  profit: { name: string; currency: string; profit: string }[];
};
type CartLine = { product: Product; quantity: number };
type ModuleId = "pos" | "product" | "inventory" | "supplier" | "purchase"
  | "category" | "tables" | "dashboard" | "expense" | "reports" | "users"
  | "settings" | "invoice" | "kitchen" | "audit";

const moduleLinks: { id: ModuleId; label: string; icon: string; permission?: string; resource?: WorkspaceModule }[] = [
  { id: "pos", label: "POS", icon: "▣", permission: "pos.use" },
  { id: "product", label: "Product", icon: "▰", permission: "catalog.read", resource: "product" },
  { id: "inventory", label: "Inventory", icon: "▤", permission: "inventory.read", resource: "inventory" },
  { id: "supplier", label: "Supplier", icon: "♧", permission: "suppliers.read", resource: "supplier" },
  { id: "purchase", label: "Purchase", icon: "⇧", permission: "purchases.read", resource: "purchase" },
  { id: "category", label: "Category", icon: "▦", permission: "catalog.read", resource: "category" },
  { id: "tables", label: "Tables", icon: "▱", permission: "tables.read", resource: "tables" },
  { id: "expense", label: "Expense", icon: "¤", permission: "expenses.read", resource: "expense" },
  { id: "reports", label: "Reports", icon: "▥", permission: "reports.view" },
  { id: "users", label: "Users", icon: "♙", permission: "users.manage", resource: "users" },
  { id: "settings", label: "Settings", icon: "⚙", permission: "settings.read", resource: "settings" },
  { id: "invoice", label: "Invoice list", icon: "▧", permission: "invoices.view", resource: "invoice" },
  { id: "kitchen", label: "KOT", icon: "▣", permission: "kitchen.use" },
  { id: "audit", label: "Audit log", icon: "◷", permission: "audit.read", resource: "audit" },
];

const request = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
};

const dateInput = (date: Date) => {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 10);
};

function money(value: string | number, currency: string) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number(value));
}

const shortDate = (value: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

export default function PosApp() {
  const [user, setUser] = useState<User | null>(null);
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [tab, setTab] = useState<ModuleId>("dashboard");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [orderType, setOrderType] = useState<"take_away" | "dine_in">("take_away");
  const [tableId, setTableId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [orders, setOrders] = useState<Order[]>([]);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [fromDate, setFromDate] = useState(() => dateInput(new Date(Date.now() - 29 * 86_400_000)));
  const [toDate, setToDate] = useState(() => dateInput(new Date()));
  const [activeOrder, setActiveOrder] = useState<{ id: number; number: string; total: string; currency: string } | null>(null);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [moduleRows, setModuleRows] = useState<Record<string, Record<string, unknown>[]>>({});
  const [moduleExtras, setModuleExtras] = useState<Record<string, Record<string, unknown>>>({});

  const currency = bootstrap?.settings.currency ?? "USD";
  const cartTotals = useMemo(() => {
    const subtotalCents = cart.reduce(
      (sum, item) => sum + Math.round(Number(item.product.price) * 100) * item.quantity,
      0,
    );
    const percent = (value: string | undefined) => Math.round(Number(value ?? 0) * 100);
    const discountCents = Math.round(subtotalCents * percent(bootstrap?.settings.discount) / 10_000);
    const afterDiscountCents = subtotalCents - discountCents;
    const vatCents = Math.round(afterDiscountCents * percent(bootstrap?.settings.vat) / 10_000);
    const serviceCents = Math.round(
      (afterDiscountCents + vatCents) * percent(bootstrap?.settings.service) / 10_000,
    );
    return {
      subtotal: subtotalCents / 100,
      discount: discountCents / 100,
      vat: vatCents / 100,
      service: serviceCents / 100,
      total: (afterDiscountCents + vatCents + serviceCents) / 100,
    };
  }, [bootstrap, cart]);

  const loadProducts = useCallback(async () => {
    const params = new URLSearchParams();
    if (search.trim()) params.set("q", search.trim());
    if (categoryId) params.set("category", categoryId);
    const result = await request<{ products: Product[] }>(`/api/products?${params}`);
    setProducts(result.products);
  }, [search, categoryId]);

  const loadOrders = useCallback(async () => {
    const result = await request<{ orders: Order[] }>("/api/orders");
    setOrders(result.orders);
  }, []);

  const loadKitchen = useCallback(async () => {
    const result = await request<{ orders: Order[] }>("/api/orders?view=kitchen");
    setOrders(result.orders);
  }, []);

  const loadDashboard = useCallback(async () => {
    const result = await request<Dashboard>("/api/dashboard");
    setDashboard(result);
  }, []);

  const loadReport = useCallback(async () => {
    const params = new URLSearchParams({ from: fromDate, to: toDate });
    const result = await request<Report>(`/api/reports?${params}`);
    setReport(result);
  }, [fromDate, toDate]);

  const loadModule = useCallback(async (module: WorkspaceModule) => {
    const route: Record<WorkspaceModule, string> = {
      product: "products", category: "categories", inventory: "inventory",
      supplier: "suppliers", purchase: "purchases", tables: "tables",
      expense: "expenses", users: "users", settings: "settings",
      invoice: "invoices", audit: "audit",
    };
    const result = await request<{ rows: Record<string, unknown>[]; [key: string]: unknown }>(
      `/api/modules/${route[module]}`,
    );
    setModuleRows((current) => ({ ...current, [module]: result.rows }));
    const { rows: _rows, ...extras } = result;
    setModuleExtras((current) => ({ ...current, [module]: extras }));
  }, []);

  const saveModule = useCallback(async (
    module: WorkspaceModule,
    values: Record<string, unknown>,
    id?: number,
  ) => {
    const route: Record<WorkspaceModule, string> = {
      product: "products", category: "categories", inventory: "inventory",
      supplier: "suppliers", purchase: "purchases", tables: "tables",
      expense: "expenses", users: "users", settings: "settings",
      invoice: "invoices", audit: "audit",
    };
    setBusy(true);
    setNotice("");
    let uploadedImageKey: string | undefined;
    let saved = false;
    try {
      const requestValues = { ...values };
      const photo = requestValues.photo;
      delete requestValues.photo;
      delete requestValues.currentImageUrl;
      if (module === "product" && photo instanceof File) {
        const formData = new FormData();
        formData.append("file", photo);
        const response = await fetch("/api/products/image", { method: "POST", body: formData });
        const result = await response.json() as { key?: string; error?: string };
        if (!response.ok || !result.key) throw new Error(result.error || "Could not upload product photo.");
        uploadedImageKey = result.key;
        requestValues.imageKey = uploadedImageKey;
      }
      await request(`/api/modules/${route[module]}`, {
        method: id === undefined ? "POST" : "PATCH",
        body: JSON.stringify(id === undefined ? requestValues : { ...requestValues, id }),
      });
      saved = true;
      setNotice(`${moduleLinks.find((item) => item.resource === module)?.label ?? "Record"} saved.`);
      await loadModule(module);
      if (module === "product" || module === "category") await loadProducts();
      if (module === "settings") {
        const current = await request<Bootstrap & { user: User }>("/api/bootstrap");
        setBootstrap(current);
      }
    } catch (error) {
      if (uploadedImageKey && !saved) {
        try {
          await request("/api/products/image", {
            method: "DELETE",
            body: JSON.stringify({ key: uploadedImageKey }),
          });
        } catch (cleanupError) {
          console.error("Could not clean up an unused product photo.", cleanupError);
        }
      }
      setNotice(error instanceof Error ? error.message : "Could not save this record.");
      throw error;
    } finally {
      setBusy(false);
    }
  }, [loadModule, loadProducts]);

  const finalizePurchase = useCallback(async (id: number) => {
    setBusy(true);
    setNotice("");
    try {
      await request("/api/modules/purchases", {
        method: "PATCH",
        body: JSON.stringify({ id, action: "finalize" }),
      });
      setNotice(`Purchase #${id} received into inventory.`);
      await Promise.all([loadModule("purchase"), loadModule("inventory"), loadProducts()]);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not receive purchase.");
    } finally {
      setBusy(false);
    }
  }, [loadModule, loadProducts]);

  const enterApp = useCallback(async (signedInUser: User) => {
    setUser(signedInUser);
    setNotice("");
    try {
      setTab(
        signedInUser.role === "Kitchen"
          ? "kitchen"
          : ["Admin", "Manager"].includes(signedInUser.role)
            ? "dashboard"
            : "pos",
      );
      if (signedInUser.role !== "Kitchen") {
        const config = await request<Bootstrap & { user: User }>("/api/bootstrap");
        setBootstrap(config);
        setUser(config.user);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not load the app.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    request<{ user: User | null }>("/api/auth/session")
      .then(async ({ user: signedInUser }) => {
        if (active && signedInUser) await enterApp(signedInUser);
        else if (active) setLoading(false);
      })
      .catch(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [enterApp]);

  useEffect(() => {
    if (!user || loading) return;
    if (tab === "pos" && user.role !== "Kitchen") {
      loadProducts().catch((error: unknown) => setNotice(error instanceof Error ? error.message : "Could not load products."));
    } else if (tab === "kitchen") {
      loadKitchen().catch((error: unknown) => setNotice(error instanceof Error ? error.message : "Could not load kitchen tickets."));
    } else if (tab === "dashboard" && ["Admin", "Manager"].includes(user.role)) {
      loadDashboard().catch((error: unknown) => setNotice(error instanceof Error ? error.message : "Could not load dashboard."));
    } else if (tab === "reports" && ["Admin", "Manager"].includes(user.role)) {
      loadReport().catch((error: unknown) => setNotice(error instanceof Error ? error.message : "Could not load reports."));
    } else {
      const module = moduleLinks.find((item) => item.id === tab)?.resource;
      if (module) loadModule(module).catch((error: unknown) => setNotice(error instanceof Error ? error.message : "Could not load module."));
    }
  }, [loadDashboard, loadKitchen, loadModule, loadProducts, loadReport, loading, tab, user]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    try {
      const result = await request<{ user: User }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, pin }),
      });
      setPin("");
      await enterApp(result.user);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    try {
      await request("/api/auth/logout", { method: "POST" });
      setUser(null);
      setBootstrap(null);
      setCart([]);
      setActiveOrder(null);
      setPaymentDialogOpen(false);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not sign out.");
    } finally {
      setBusy(false);
    }
  }

  function addToCart(product: Product) {
    setCart((current) => {
      const existing = current.find((line) => line.product.id === product.id);
      if (existing) {
        if (existing.quantity >= product.stock_quantity) {
          setNotice("Cart quantity cannot exceed the available stock.");
          return current;
        }
        return current.map((line) => line.product.id === product.id
          ? { ...line, quantity: line.quantity + 1 }
          : line);
      }
      return [...current, { product, quantity: 1 }];
    });
    setNotice("");
  }

  function changeQuantity(productId: number, quantity: number) {
    if (quantity < 1) {
      setCart((current) => current.filter((line) => line.product.id !== productId));
      return;
    }
    const product = products.find((item) => item.id === productId);
    if (product && quantity > product.stock_quantity) {
      setNotice("Cart quantity cannot exceed the available stock.");
      return;
    }
    setCart((current) => current.map((line) =>
      line.product.id === productId ? { ...line, quantity } : line,
    ));
  }

  function resetSale(resetDetails: boolean) {
    if (cart.length && !window.confirm("Discard the current sale items?")) return;
    setCart([]);
    if (resetDetails) {
      setCustomerName("");
      setOrderType("take_away");
      setTableId("");
    }
    setNotice("");
  }

  async function createOrder(openPayment: boolean) {
    if (activeOrder) {
      setNotice("Complete or close the pending payment before saving another order.");
      setPaymentDialogOpen(true);
      return;
    }
    if (!cart.length) return;
    if (orderType === "dine_in" && !tableId) {
      setNotice("Select an available table for dine-in.");
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      const result = await request<{ orderId: number; orderNumber: string; total: string; currency: string }>("/api/orders", {
        method: "POST",
        body: JSON.stringify({
          orderType,
          customerName: customerName.trim(),
          tableId: orderType === "dine_in" ? Number(tableId) : null,
          items: cart.map((line) => ({ productId: line.product.id, quantity: line.quantity })),
        }),
      });
      setActiveOrder({ id: result.orderId, number: result.orderNumber, total: result.total, currency: result.currency });
      setPaymentAmount(result.total);
      setPaymentDialogOpen(openPayment);
      setCart([]);
      setNotice(`Order ${result.orderNumber} saved. Record payment to complete it.`);
      await loadProducts();
      await loadOrders();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save order.");
    } finally {
      setBusy(false);
    }
  }

  async function recordPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeOrder) return;
    setBusy(true);
    setNotice("");
    try {
      const result = await request<{ status: string }>(`/api/orders/${activeOrder.id}/payment`, {
        method: "POST",
        body: JSON.stringify({ method: paymentMethod, amount: paymentAmount }),
      });
      setNotice(result.status === "paid"
        ? `Payment recorded. Order ${activeOrder.number} is paid.`
        : paymentMethod === "m-pesa"
          ? "M-Pesa payment is pending confirmation; no live payment request was sent."
          : "Payment recorded as pending until the full balance is paid.");
      if (result.status === "paid") {
        setActiveOrder(null);
        setPaymentDialogOpen(false);
        await loadProducts();
        await loadOrders();
        if (user && ["Admin", "Manager"].includes(user.role)) await loadDashboard();
      }

    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not record payment.");
    } finally {
      setBusy(false);
    }
  }

  async function advanceTicket(order: Order) {
    setBusy(true);
    setNotice("");
    try {
      await request(`/api/kitchen/${order.id}`, { method: "POST" });
      await loadKitchen();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not update kitchen ticket.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <main className="loading-screen"><span className="brand-mark">D</span><p>Connecting to your restaurant…</p></main>;
  }

  if (!user) {
    return (
      <main className="login-screen">
        <section className="login-card">
          <div className="brand-mark">D</div>
          <p className="eyebrow">RESTAURANT OPERATIONS</p>
          <h1>Welcome back</h1>
          <p className="muted">Sign in with your staff account to continue.</p>
          {notice && <div className="notice error">{notice}</div>}
          <form onSubmit={signIn} className="login-form">
            <label>Username<input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required /></label>
            <label>PIN<input type="password" inputMode="numeric" autoComplete="current-password" maxLength={32} value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))} required /></label>
            <button className="primary full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
          </form>
          <p className="login-note">Connected to your Neon database</p>
        </section>
      </main>
    );
  }

  const canReports = ["Admin", "Manager"].includes(user.role);
  const visibleModules = moduleLinks.filter((item) => {
    if (user.role === "Admin") return true;
    if (user.role === "Manager") return item.id !== "users";
    if (user.role === "Kitchen") return item.id === "kitchen";
    return ["pos", "product", "category", "tables", "invoice"].includes(item.id);
  });
  const currentLabel = tab === "dashboard" ? "Dashboard" : moduleLinks.find((item) => item.id === tab)?.label ?? "Workspace";

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="side-brand"><span className="brand-mark small">D</span><span>{bootstrap?.settings.restaurantName ?? "DAN POS"}<small>OPERATIONS</small></span></div>
        {canReports && <button className={tab === "dashboard" ? "dashboard-link active" : "dashboard-link"} onClick={() => { setTab("dashboard"); setNotice(""); }}><span>◫</span><span>Dashboard</span></button>}
        <div className="side-label">MODULES</div>
        <nav className="side-nav">
          {visibleModules.map((item) => (
            <button key={item.id} className={tab === item.id ? "nav-item active" : "nav-item"} onClick={() => { setTab(item.id); setNotice(""); }}>
              <span>{item.icon}</span>{item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="user-card"><div className="avatar">{user.fullName.slice(0, 1).toUpperCase()}</div><div><strong>{user.fullName}</strong><small>{user.role}</small></div></div>
          <button className="nav-item signout" onClick={signOut} disabled={busy}><span>↪</span>Sign out</button>
          <div className="connection"><i />Neon database connected</div>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div><p className="eyebrow">{new Intl.DateTimeFormat(undefined, { dateStyle: "full" }).format(new Date())}</p><h1>{currentLabel}</h1></div>
          <div className="topbar-user"><span className="online-dot" />{user.fullName}<span className="role-pill">{user.role}</span></div>
        </header>
        {notice && <div className={`notice ${notice.toLowerCase().includes("could not") || notice.toLowerCase().includes("invalid") ? "error" : ""}`} role="status">{notice}<button onClick={() => setNotice("")}>×</button></div>}

        {tab === "pos" && (
          <div className="pos-layout">
            <aside className="cart-panel">
              <div className="pos-order-meta">
                <strong><span>Order</span>{activeOrder?.number ?? "New order"}</strong>
                <strong><span>Customer</span>{customerName.trim() || "Walk-in customer"}</strong>
                <strong><span>Type</span>{orderType === "dine_in" ? "Dine in" : "Take away"}</strong>
                <strong><span>Table</span>{orderType === "dine_in" ? bootstrap?.tables.find((table) => String(table.id) === tableId)?.table_name ?? "Not selected" : "—"}</strong>
              </div>
              {activeOrder && <div className="pos-pending-order"><span>Payment due for {activeOrder.number}</span><button type="button" onClick={() => { setPaymentAmount(activeOrder.total); setPaymentDialogOpen(true); }}>Complete payment</button></div>}
              <div className="cart-title"><div><p className="eyebrow">CURRENT SALE</p><h2>Order items</h2></div><span className="count-pill">{cart.reduce((sum, line) => sum + line.quantity, 0)} items</span></div>
              <div className="order-controls">
                <label>Order type<select value={orderType} onChange={(event) => { setOrderType(event.target.value as "take_away" | "dine_in"); if (event.target.value === "take_away") setTableId(""); }}><option value="take_away">Take away</option><option value="dine_in">Dine in</option></select></label>
                {orderType === "dine_in" && <label>Select table<select value={tableId} onChange={(event) => setTableId(event.target.value)}><option value="">Choose available table</option>{bootstrap?.tables.map((table) => <option key={table.id} value={table.id}>{table.table_name} · {table.capacity} seats</option>)}</select></label>}
                <label className="customer-control">Customer<input aria-label="Customer name" placeholder="Walk-in customer" value={customerName} onChange={(event) => setCustomerName(event.target.value)} /></label>
              </div>
              <div className="cart-table-header"><span>Item description</span><span>Qty</span><span>Price</span><span>Total</span><span>Action</span></div>
              <div className="cart-lines">
                {cart.map((line) => <div className="cart-line" key={line.product.id}>
                  <div className="cart-product"><strong>{line.product.name}</strong><small>{line.product.category_name}</small></div>
                  <div className="quantity-control"><button aria-label={`Remove one ${line.product.name}`} onClick={() => changeQuantity(line.product.id, line.quantity - 1)}>−</button><span>{line.quantity}</span><button aria-label={`Add one ${line.product.name}`} onClick={() => changeQuantity(line.product.id, line.quantity + 1)}>+</button></div>
                  <span className="cart-unit-price">{money(line.product.price, currency)}</span>
                  <b className="line-total">{money(Number(line.product.price) * line.quantity, currency)}</b>
                  <button className="remove-line" aria-label={`Remove ${line.product.name}`} onClick={() => changeQuantity(line.product.id, 0)}>×</button>
                </div>)}
                {!cart.length && <div className="cart-empty"><span>＋</span><strong>Your order is empty</strong><small>Add items from the menu to get started.</small></div>}
              </div>
              <div className="cart-summary">
                <div><span>Subtotal</span><span>{money(cartTotals.subtotal, currency)}</span></div>
                <div><span>Discount ({bootstrap?.settings.discount ?? "0"}%)</span><span>−{money(cartTotals.discount, currency)}</span></div>
                <div><span>VAT ({bootstrap?.settings.vat ?? "0"}%)</span><span>{money(cartTotals.vat, currency)}</span></div>
                <div><span>Service ({bootstrap?.settings.service ?? "0"}%)</span><span>{money(cartTotals.service, currency)}</span></div>
                <div className="grand-total"><strong>Total</strong><strong>{money(cartTotals.total, currency)}</strong></div>
                <div className="pos-actions">
                  <button type="button" className="pos-new-button" disabled={busy || Boolean(activeOrder)} onClick={() => resetSale(true)}>＋ New</button>
                  <button type="button" className="secondary" disabled={busy || Boolean(activeOrder) || !cart.length} onClick={() => resetSale(false)}>Cancel</button>
                  <button type="button" className="primary" disabled={!cart.length || busy || Boolean(activeOrder)} onClick={() => createOrder(false)}>{busy ? "Saving…" : "Save order"}</button>
                </div>
                <button className="payment-button" disabled={(!cart.length && !activeOrder) || busy} onClick={() => activeOrder ? (setPaymentAmount(activeOrder.total), setPaymentDialogOpen(true)) : createOrder(true)}>✓ Payment</button>
              </div>
            </aside>

            <section className="catalog-panel pos-catalog">
              <div className="pos-catalog-heading"><div><p className="eyebrow">MENU</p><h2>{categoryId ? bootstrap?.categories.find((category) => String(category.id) === categoryId)?.name : "Products"}</h2></div><span className="count-pill">{products.length} products</span></div>
              <div className="catalog-tools">
                <div className="search-box"><span>⌕</span><input aria-label="Search menu" placeholder="Scan barcode or search products…" value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && products.length === 1) addToCart(products[0]); }} /></div>
              </div>
              <div className="product-grid">
                {products.map((product) => <button className="product-card" key={product.id} onClick={() => addToCart(product)}>
                  {product.image_path && /^https?:\/\//i.test(product.image_path)
                    ? <img className="product-photo" src={product.image_path} alt="" />
                    : <span className="product-icon">{product.name.slice(0, 1).toUpperCase()}</span>}
                  <strong>{product.name}</strong><span className="product-category">{product.category_name}</span>
                  <span className="product-card-bottom"><b>{money(product.price, currency)}</b><small>{product.stock_quantity} left</small></span>
                </button>)}
                {!products.length && <div className="empty-state">No available products match your search.</div>}
              </div>
              <div className="pos-category-strip">
                <button className={!categoryId ? "active" : ""} onClick={() => setCategoryId("")}>All</button>
                {bootstrap?.categories.map((category) => <button key={category.id} className={categoryId === String(category.id) ? "active" : ""} onClick={() => setCategoryId(String(category.id))}>{category.name}</button>)}
              </div>
            </section>
          </div>
        )}

        {tab === "pos" && activeOrder && paymentDialogOpen && (
          <div className="payment-backdrop">
            <form className="payment-dialog" onSubmit={recordPayment}>
              <button type="button" className="dialog-close" aria-label="Close" onClick={() => setPaymentDialogOpen(false)}>×</button>
              <p className="eyebrow">ORDER {activeOrder.number}</p><h2>Record payment</h2>
              <div className="payment-total">{money(activeOrder.total, activeOrder.currency)}</div>
              <label>Payment method<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><option value="cash">Cash</option><option value="card">Card</option><option value="m-pesa">M-Pesa (pending)</option><option value="other">Other</option></select></label>
              <label>Amount paid<input inputMode="decimal" type="number" step="0.01" min="0.01" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} required /></label>
              {paymentMethod === "m-pesa" && <p className="payment-warning">This records a pending payment only. It will not contact M-Pesa.</p>}
              <button className="primary full" disabled={busy}>{busy ? "Recording…" : "Confirm payment"}</button>
            </form>
          </div>
        )}

        {tab === "dashboard" && <section className="page-content">
          <div className="section-heading"><div><h2>Today at a glance</h2><p>Live totals from paid orders in your Neon database.</p></div><button className="secondary" onClick={() => loadDashboard()}>↻ Refresh</button></div>
          <div className="stats-grid">
            <article className="stat-card"><span className="stat-icon orange">↗</span><small>Today's sales</small>{dashboard?.sales.length ? dashboard.sales.map((item) => <strong key={item.currency}>{money(item.total, item.currency)}</strong>) : <strong>{money(0, currency)}</strong>}</article>
            <article className="stat-card"><span className="stat-icon green">▤</span><small>Paid orders</small><strong>{dashboard?.sales.reduce((sum, item) => sum + Number(item.order_count), 0) ?? 0}</strong></article>
            <article className="stat-card"><span className="stat-icon blue">▦</span><small>Available tables</small><strong>{dashboard?.tables.available ?? 0}</strong></article>
            <article className="stat-card"><span className="stat-icon red">!</span><small>Low-stock products</small><strong>{dashboard?.lowStock.length ?? 0}</strong></article>
          </div>
          <section className="data-card"><div className="section-heading"><div><h2>Needs attention</h2><p>Products at or below their reorder threshold.</p></div></div>
            <div className="table-scroll"><table><thead><tr><th>Product</th><th>In stock</th><th>Reorder at</th><th>Status</th></tr></thead><tbody>
              {dashboard?.lowStock.map((item) => <tr key={item.id}><td className="cell-strong">{item.name}</td><td>{item.stock_quantity}</td><td>{item.min_stock}</td><td><span className="status-tag warning">Low stock</span></td></tr>)}
              {!dashboard?.lowStock.length && <tr><td colSpan={4} className="empty-row">All products are above their low-stock threshold.</td></tr>}
            </tbody></table></div>
          </section>
        </section>}

        {tab === "kitchen" && <section className="kitchen-page">
          <div className="kitchen-title"><h2>Kitchen orders display</h2><button className="secondary" onClick={() => loadKitchen()}>↻ Refresh</button></div>
          <div className="kitchen-board">
            {([
              ["pending", "New orders", "New"],
              ["preparing", "Accepted orders", "Processing"],
              ["ready", "Completed orders", "Done"],
              ["completed", "Delivered orders", "Delivered"],
            ] as const).map(([status, title, displayStatus]) => {
              const laneOrders = orders.filter((order) => order.kitchen_status === status);
              return <section className="kitchen-lane" key={status}>
                <h3>{title}<span>{laneOrders.length}</span></h3>
                <div className="kitchen-lane-list">{laneOrders.map((order) => <article className="kitchen-ticket" key={order.id}>
                  <div className="kitchen-ticket-heading"><strong># ORDER NO: {order.order_number.replace(/^ORD-/, "")}</strong><span>{displayStatus}</span></div>
                  <p><b>Order type:</b> {order.order_type === "dine_in" ? "Dine in" : "Pick up"}</p>
                  <p><b>Customer:</b> {order.customer_name || "Walk-in customer"}</p>
                  <p><b>Table:</b> {order.table_name || "Not selected"}</p>
                  <small>{shortDate(order.created_at)}</small>
                  <ul className="ticket-items">{order.items?.map((item, index) => <li key={`${item.name}-${index}`}><strong>{item.quantity} × {item.name}</strong>{item.special_instructions && <small>{item.special_instructions}</small>}</li>)}</ul>
                  {status !== "completed" && <div className="kitchen-ticket-actions">
                    <button className="primary" disabled={busy} onClick={() => advanceTicket(order)}>{status === "pending" ? "Accept" : status === "preparing" ? "Done" : "Deliver"}</button>
                    <button className="secondary" onClick={() => setNotice(`Order ${order.order_number} · ${order.items?.map((item) => `${item.quantity} × ${item.name}`).join(", ") || "No item details"}`)}>View</button>
                  </div>}
                </article>)}
                {!laneOrders.length && <p className="kitchen-empty">No {title.toLowerCase()}.</p>}</div>
              </section>;
            })}
          </div>
        </section>}

        {tab === "invoice" && <section className="page-content">
          {activeOrder && <div className="active-order-banner"><div><strong>{activeOrder.number}</strong><span>Payment still due · {money(activeOrder.total, activeOrder.currency)}</span></div><button className="primary" onClick={() => { setTab("pos"); setPaymentDialogOpen(true); }}>Complete payment</button></div>}
          <WorkspaceModules module="invoice" rows={moduleRows.invoice ?? []} extras={moduleExtras.invoice ?? {}} canManage={false} busy={busy} onSave={saveModule} onRefresh={() => loadModule("invoice")} />
        </section>}

        {tab === "reports" && <section className="page-content">
          <div className="section-heading"><div><h2>Sales performance</h2><p>Compare sales, expenses, and gross profit by currency.</p></div>
            <div className="date-filter"><label>From<input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label><label>To<input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></label><button className="primary" onClick={() => loadReport()}>Apply</button></div>
          </div>
          <div className="stats-grid report-stats">
            <article className="stat-card"><small>Sales</small>{report?.sales.map((item) => <strong key={item.currency}>{money(item.total, item.currency)}</strong>) ?? <strong>—</strong>}</article>
            <article className="stat-card"><small>Expenses</small>{report?.expenses.map((item) => <strong key={item.currency}>{money(item.total, item.currency)}</strong>) ?? <strong>—</strong>}</article>
            <article className="stat-card"><small>Paid orders</small><strong>{report?.sales.reduce((sum, item) => sum + Number(item.order_count), 0) ?? 0}</strong></article>
            <article className="stat-card"><small>Gross profit (top products)</small>{report?.profit.slice(0, 1).map((item) => <strong key={item.currency}>{money(item.profit, item.currency)}</strong>) ?? <strong>—</strong>}</article>
          </div>
          <div className="report-grid">
            <ReportTable title="Sales by product" headers={["Product", "Qty", "Sales"]} rows={report?.products.map((item) => [item.name, String(item.quantity), money(item.sales, item.currency)]) ?? []} />
            <ReportTable title="Sales by category" headers={["Category", "Qty", "Sales"]} rows={report?.categories.map((item) => [item.name, String(item.quantity), money(item.sales, item.currency)]) ?? []} />
            <ReportTable title="Sales by cashier" headers={["Cashier", "Orders", "Sales"]} rows={report?.cashiers.map((item) => [item.cashier, String(item.order_count), money(item.sales, item.currency)]) ?? []} />
            <ReportTable title="Payment methods" headers={["Method", "Currency", "Paid"]} rows={report?.payments.map((item) => [item.method, item.currency, money(item.total, item.currency)]) ?? []} />
            <ReportTable title="Gross profit by product" headers={["Product", "Currency", "Gross profit"]} rows={report?.profit.map((item) => [item.name, item.currency, money(item.profit, item.currency)]) ?? []} />
          </div>
        </section>}

        {visibleModules.map((item) => item.resource && item.id !== "invoice" && tab === item.id && (
          <WorkspaceModules
            key={item.id}
            module={item.resource}
            rows={moduleRows[item.resource] ?? []}
            extras={moduleExtras[item.resource] ?? {}}
            canManage={user.role === "Admin" || (user.role === "Manager" && !["settings", "users"].includes(item.resource))}
            busy={busy}
            onSave={saveModule}
            onFinalizePurchase={item.id === "purchase" ? finalizePurchase : undefined}
            onRefresh={() => loadModule(item.resource!)}
          />
        ))}
      </section>
    </main>
  );
}

function ReportTable({ title, headers, rows }: { title: string; headers: string[]; rows: string[][] }) {
  return <section className="data-card report-card"><h2>{title}</h2><div className="table-scroll"><table><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>
    {rows.map((row, index) => <tr key={`${row[0]}-${index}`}>{row.map((value, cell) => <td className={cell === 0 ? "cell-strong" : ""} key={cell}>{value}</td>)}</tr>)}
    {!rows.length && <tr><td className="empty-row" colSpan={headers.length}>No data for this period.</td></tr>}
  </tbody></table></div></section>;
}
