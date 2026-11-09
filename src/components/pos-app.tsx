"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type User = { id: number; username: string; fullName: string; role: string };
type Product = {
  id: number;
  name: string;
  barcode: string | null;
  price: string;
  stock_quantity: number;
  category_id: number;
  category_name: string;
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
type Tab = "overview" | "pos" | "orders" | "reports";

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
  const [tab, setTab] = useState<Tab>("pos");
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
  const [orders, setOrders] = useState<Order[]>([]);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [fromDate, setFromDate] = useState(() => dateInput(new Date(Date.now() - 29 * 86_400_000)));
  const [toDate, setToDate] = useState(() => dateInput(new Date()));
  const [activeOrder, setActiveOrder] = useState<{ id: number; number: string; total: string; currency: string } | null>(null);
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [paymentAmount, setPaymentAmount] = useState("");

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

  const loadDashboard = useCallback(async () => {
    const result = await request<Dashboard>("/api/dashboard");
    setDashboard(result);
  }, []);

  const loadReport = useCallback(async () => {
    const params = new URLSearchParams({ from: fromDate, to: toDate });
    const result = await request<Report>(`/api/reports?${params}`);
    setReport(result);
  }, [fromDate, toDate]);

  const enterApp = useCallback(async (signedInUser: User) => {
    setUser(signedInUser);
    setNotice("");
    try {
      setTab(signedInUser.role === "Kitchen" ? "orders" : "pos");
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
    } else if (tab === "orders") {
      loadOrders().catch((error: unknown) => setNotice(error instanceof Error ? error.message : "Could not load orders."));
    } else if (tab === "overview" && ["Admin", "Manager"].includes(user.role)) {
      loadDashboard().catch((error: unknown) => setNotice(error instanceof Error ? error.message : "Could not load dashboard."));
    } else if (tab === "reports" && ["Admin", "Manager"].includes(user.role)) {
      loadReport().catch((error: unknown) => setNotice(error instanceof Error ? error.message : "Could not load reports."));
    }
  }, [loadDashboard, loadOrders, loadProducts, loadReport, loading, tab, user]);

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

  async function createOrder() {
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
          tableId: orderType === "dine_in" ? Number(tableId) : null,
          items: cart.map((line) => ({ productId: line.product.id, quantity: line.quantity })),
        }),
      });
      setActiveOrder({ id: result.orderId, number: result.orderNumber, total: result.total, currency: result.currency });
      setPaymentAmount(result.total);
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
      await loadOrders();
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
  const tabs: { id: Tab; label: string; icon: string; visible: boolean }[] = [
    { id: "overview", label: "Overview", icon: "◫", visible: canReports },
    { id: "pos", label: "Point of sale", icon: "▣", visible: user.role !== "Kitchen" },
    { id: "orders", label: user.role === "Kitchen" ? "Kitchen tickets" : "Orders", icon: "▤", visible: true },
    { id: "reports", label: "Reports", icon: "▥", visible: canReports },
  ];

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="side-brand"><span className="brand-mark small">D</span><span>{bootstrap?.settings.restaurantName ?? "DAN POS"}<small>OPERATIONS</small></span></div>
        <div className="side-label">WORKSPACE</div>
        <nav className="side-nav">
          {tabs.filter((item) => item.visible).map((item) => (
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
          <div><p className="eyebrow">{new Intl.DateTimeFormat(undefined, { dateStyle: "full" }).format(new Date())}</p><h1>{tabs.find((item) => item.id === tab)?.label}</h1></div>
          <div className="topbar-user"><span className="online-dot" />{user.fullName}<span className="role-pill">{user.role}</span></div>
        </header>
        {notice && <div className={`notice ${notice.toLowerCase().includes("could not") || notice.toLowerCase().includes("invalid") ? "error" : ""}`} role="status">{notice}<button onClick={() => setNotice("")}>×</button></div>}

        {tab === "pos" && (
          <div className="pos-layout">
            <section className="catalog-panel">
              <div className="section-heading"><div><h2>Menu</h2><p>Choose an item to add it to the order.</p></div><span className="count-pill">{products.length} items</span></div>
              <div className="catalog-tools">
                <div className="search-box"><span>⌕</span><input aria-label="Search menu" placeholder="Search products or scan barcode" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
                <select aria-label="Filter by category" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">All categories</option>{bootstrap?.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>
              </div>
              <div className="product-grid">
                {products.map((product) => <button className="product-card" key={product.id} onClick={() => addToCart(product)}>
                  <span className="product-icon">{product.name.slice(0, 1).toUpperCase()}</span><span className="product-category">{product.category_name}</span><strong>{product.name}</strong><span className="product-card-bottom"><b>{money(product.price, currency)}</b><small>{product.stock_quantity} in stock</small></span>
                </button>)}
                {!products.length && <div className="empty-state">No available products match your search.</div>}
              </div>
            </section>

            <aside className="cart-panel">
              <div className="cart-title"><div><p className="eyebrow">NEW SALE</p><h2>Current order</h2></div><span className="count-pill">{cart.reduce((sum, line) => sum + line.quantity, 0)} items</span></div>
              <div className="order-controls">
                <select value={orderType} onChange={(event) => setOrderType(event.target.value as "take_away" | "dine_in")}><option value="take_away">Take away</option><option value="dine_in">Dine in</option></select>
                {orderType === "dine_in" && <select value={tableId} onChange={(event) => setTableId(event.target.value)}><option value="">Select table</option>{bootstrap?.tables.map((table) => <option key={table.id} value={table.id}>{table.table_name} · {table.capacity} seats</option>)}</select>}
              </div>
              <div className="cart-lines">
                {cart.map((line) => <div className="cart-line" key={line.product.id}>
                  <div className="cart-product"><strong>{line.product.name}</strong><small>{money(line.product.price, currency)} each</small></div>
                  <div className="quantity-control"><button aria-label={`Remove one ${line.product.name}`} onClick={() => changeQuantity(line.product.id, line.quantity - 1)}>−</button><span>{line.quantity}</span><button aria-label={`Add one ${line.product.name}`} onClick={() => changeQuantity(line.product.id, line.quantity + 1)}>+</button></div>
                  <b className="line-total">{money(Number(line.product.price) * line.quantity, currency)}</b>
                </div>)}
                {!cart.length && <div className="cart-empty"><span>＋</span><strong>Your order is empty</strong><small>Add items from the menu to get started.</small></div>}
              </div>
              <div className="cart-summary">
                <div><span>Subtotal</span><span>{money(cartTotals.subtotal, currency)}</span></div>
                {cartTotals.discount > 0 && <div><span>Discount ({bootstrap?.settings.discount}%)</span><span>−{money(cartTotals.discount, currency)}</span></div>}
                {cartTotals.vat > 0 && <div><span>VAT ({bootstrap?.settings.vat}%)</span><span>{money(cartTotals.vat, currency)}</span></div>}
                {cartTotals.service > 0 && <div><span>Service charge ({bootstrap?.settings.service}%)</span><span>{money(cartTotals.service, currency)}</span></div>}
                <div className="grand-total"><strong>Total</strong><strong>{money(cartTotals.total, currency)}</strong></div>
                <button className="primary full" disabled={!cart.length || busy} onClick={createOrder}>{busy ? "Saving order…" : "Save order"}<span>→</span></button>
              </div>
            </aside>
          </div>
        )}

        {tab === "pos" && activeOrder && (
          <div className="payment-backdrop">
            <form className="payment-dialog" onSubmit={recordPayment}>
              <button type="button" className="dialog-close" aria-label="Close" onClick={() => setActiveOrder(null)}>×</button>
              <p className="eyebrow">ORDER {activeOrder.number}</p><h2>Record payment</h2>
              <div className="payment-total">{money(activeOrder.total, activeOrder.currency)}</div>
              <label>Payment method<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><option value="cash">Cash</option><option value="card">Card</option><option value="m-pesa">M-Pesa (pending)</option><option value="other">Other</option></select></label>
              <label>Amount paid<input inputMode="decimal" type="number" step="0.01" min="0.01" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} required /></label>
              {paymentMethod === "m-pesa" && <p className="payment-warning">This records a pending payment only. It will not contact M-Pesa.</p>}
              <button className="primary full" disabled={busy}>{busy ? "Recording…" : "Confirm payment"}</button>
            </form>
          </div>
        )}

        {tab === "overview" && <section className="page-content">
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

        {tab === "orders" && <section className="page-content">
          {activeOrder && <div className="active-order-banner"><div><strong>{activeOrder.number}</strong><span>Payment still due · {money(activeOrder.total, activeOrder.currency)}</span></div><button className="primary" onClick={() => setTab("pos")}>Complete payment</button></div>}
          <div className="section-heading"><div><h2>Recent orders</h2><p>Latest 100 orders, including payment and kitchen status.</p></div><button className="secondary" onClick={() => loadOrders()}>↻ Refresh</button></div>
          {user.role === "Kitchen" ? <div className="ticket-grid">
            {orders.map((order) => <article className="ticket-card" key={order.id}>
              <div className="ticket-head"><div><p className="eyebrow">{order.order_type === "dine_in" ? order.table_name || "DINE IN" : "TAKE AWAY"}</p><h2>{order.order_number}</h2></div><span className={`status-tag ${order.kitchen_status === "ready" ? "success" : "warning"}`}>{order.kitchen_status}</span></div>
              <small className="muted">{shortDate(order.created_at)}</small>
              <ul className="ticket-items">{order.items?.map((item, index) => <li key={`${item.name}-${index}`}><strong>{item.quantity} × {item.name}</strong>{item.special_instructions && <small>{item.special_instructions}</small>}</li>)}</ul>
              {order.kitchen_status !== "completed" && <button className="primary full" disabled={busy} onClick={() => advanceTicket(order)}>{order.kitchen_status === "pending" ? "Start preparing" : order.kitchen_status === "preparing" ? "Mark ready" : "Complete order"}</button>}
            </article>)}
            {!orders.length && <div className="empty-state">No active kitchen tickets.</div>}
          </div> : <div className="data-card table-scroll"><table><thead><tr><th>Order</th><th>Date</th><th>Type</th><th>Cashier</th><th>Total</th><th>Payment</th><th>Status</th></tr></thead><tbody>
            {orders.map((order) => <tr key={order.id}><td className="cell-strong">{order.order_number}{order.table_name && <small className="sub-cell">{order.table_name}</small>}</td><td>{shortDate(order.created_at)}</td><td>{order.order_type === "dine_in" ? "Dine in" : "Take away"}</td><td>{order.cashier ?? "—"}</td><td>{money(order.total, order.currency)}</td><td>{order.payment_method ?? (order.status === "paid" ? "Paid" : "Pending")}</td><td><span className={`status-tag ${order.status === "paid" ? "success" : order.status === "cancelled" ? "neutral" : "warning"}`}>{order.status}</span></td></tr>)}
            {!orders.length && <tr><td colSpan={7} className="empty-row">No orders found.</td></tr>}
          </tbody></table></div>}
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
