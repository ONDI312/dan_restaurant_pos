"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import WorkspaceModules, { type WorkspaceModule } from "@/components/workspace-modules";
import { can } from "@/lib/permissions";

type User = { id: number; username: string; fullName: string; role: string; permissions?: string[] };
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
  table_id?: number | null;
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
  tables: { available: number; occupied: number; total: number };
  counters: { pending: number; in_progress: number; total_orders: number; customers: number; range_revenue: string; paid_orders: number; completed: number };
  weekly: { day: number; revenue: string; subtotal: string; order_count: number }[];
  activity: { id: number; order_number: string; total: string; currency: string; status: string; kitchen_status: string; created_at: string; customer_name: string | null; dish_name: string | null; image_path: string | null }[];
  dishes: { id: number; name: string; image_path: string | null; completed_orders: number }[];
  currency: string;
  period: string;
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

const paymentMethodLabels: Record<string, string> = {
  cash: "Cash",
  card: "Card",
  "m-pesa": "M-Pesa",
  "bank-transfer": "Bank transfer",
};
const paymentMethodLabel = (method: string) => paymentMethodLabels[method] ?? method;

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
  const [dashboardPeriod, setDashboardPeriod] = useState<"week" | "month">("week");
  const [report, setReport] = useState<Report | null>(null);
  const [fromDate, setFromDate] = useState(() => dateInput(new Date(Date.now() - 29 * 86_400_000)));
  const [toDate, setToDate] = useState(() => dateInput(new Date()));
  const [activeOrder, setActiveOrder] = useState<{
    id: number;
    number: string;
    total: string;
    remaining: string;
    currency: string;
    tableName: string | null;
  } | null>(null);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [receipt, setReceipt] = useState<{ number: string; customer: string; type: string; table: string; lines: CartLine[]; total: number; currency: string } | null>(null);
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [transactionRef, setTransactionRef] = useState("");
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

  const loadPendingOrder = useCallback(async () => {
    const result = await request<{ order: {
      id: number;
      order_number: string;
      order_type: "dine_in" | "take_away";
      customer_name: string | null;
      total: string;
      currency: string;
      table_id: number | null;
      table_name: string | null;
      remaining_due: string;
    } | null }>("/api/orders?view=unpaid");
    if (!result.order) return;
    setActiveOrder({
      id: result.order.id,
      number: result.order.order_number,
      total: result.order.total,
      remaining: result.order.remaining_due,
      currency: result.order.currency,
      tableName: result.order.table_name,
    });
    setPaymentAmount(result.order.remaining_due);
    setOrderType(result.order.order_type);
    setTableId(result.order.table_id ? String(result.order.table_id) : "");
    setCustomerName(result.order.customer_name ?? "");
  }, []);

  const loadKitchen = useCallback(async () => {
    const result = await request<{ orders: Order[] }>("/api/orders?view=kitchen");
    setOrders(result.orders);
  }, []);

  const loadDashboard = useCallback(async () => {
    const result = await request<Dashboard>(`/api/dashboard?period=${dashboardPeriod}`);
    setDashboard(result);
  }, [dashboardPeriod]);

  const refreshBootstrap = useCallback(async () => {
    const current = await request<Bootstrap & { user: User }>("/api/bootstrap");
    setBootstrap(current);
    setUser(current.user);
  }, []);

  const loadReport = useCallback(async () => {
    const params = new URLSearchParams({ from: fromDate, to: toDate });
    const result = await request<Report>(`/api/reports?${params}`);
    setReport(result);
  }, [fromDate, toDate]);

  const refreshKitchen = useCallback(async () => {
    try {
      await loadKitchen();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not load kitchen tickets.");
    }
  }, [loadKitchen]);

  const refreshDashboard = useCallback(async () => {
    try {
      await loadDashboard();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not load dashboard.");
    }
  }, [loadDashboard]);

  const refreshReport = useCallback(async () => {
    try {
      await loadReport();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not load reports.");
    }
  }, [loadReport]);

  const loadModule = useCallback(async (module: WorkspaceModule, params?: URLSearchParams) => {
    const route: Record<WorkspaceModule, string> = {
      product: "products", category: "categories", inventory: "inventory",
      supplier: "suppliers", purchase: "purchases", tables: "tables",
      expense: "expenses", users: "users", settings: "settings",
      invoice: "invoices", audit: "audit",
    };
    const query = params?.toString();
    const result = await request<{ rows: Record<string, unknown>[]; [key: string]: unknown }>(
      `/api/modules/${route[module]}${query ? `?${query}` : ""}`,
    );
    setModuleRows((current) => ({ ...current, [module]: result.rows }));
    const { rows: _rows, ...extras } = result;
    setModuleExtras((current) => ({ ...current, [module]: extras }));
  }, []);

  const refreshModule = useCallback(async (module: WorkspaceModule) => {
    try {
      await loadModule(module);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not load module.");
    }
  }, [loadModule]);

  const refreshPosViews = useCallback(async (refreshConfiguration: boolean) => {
    if (!user || !can(user.role, "pos.use", user.permissions)) return;
    const tasks = [
      loadProducts().catch((error: unknown) => {
        setNotice(error instanceof Error ? error.message : "Could not refresh products.");
      }),
    ];
    if (refreshConfiguration) {
      tasks.push(refreshBootstrap().catch((error: unknown) => {
        setNotice(error instanceof Error ? error.message : "Could not refresh POS configuration.");
      }));
    }
    await Promise.all(tasks);
  }, [loadProducts, refreshBootstrap, user]);

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
      if (["product", "category", "inventory", "tables", "settings"].includes(module)) {
        await refreshPosViews(["category", "tables", "settings"].includes(module));
      }
      if (module === "users") {
        const session = await request<{ user: User | null }>("/api/auth/session");
        setUser(session.user);
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
  }, [loadModule, refreshPosViews]);

  const finalizePurchase = useCallback(async (id: number) => {
    setBusy(true);
    setNotice("");
    try {
      await request("/api/modules/purchases", {
        method: "PATCH",
        body: JSON.stringify({ id, action: "finalize" }),
      });
      setNotice(`Purchase #${id} received into inventory.`);
      await refreshModule("purchase");
      if (user && can(user.role, "inventory.read", user.permissions)) await refreshModule("inventory");
      await refreshPosViews(false);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not receive purchase.");
    } finally {
      setBusy(false);
    }
  }, [refreshModule, refreshPosViews, user]);

  const enterApp = useCallback(async (signedInUser: User) => {
    setUser(signedInUser);
    setNotice("");
    try {
      const landingTab = signedInUser.role === "Kitchen" && can(signedInUser.role, "kitchen.use", signedInUser.permissions)
        ? "kitchen"
        : can(signedInUser.role, "reports.view", signedInUser.permissions)
          ? "dashboard"
          : can(signedInUser.role, "pos.use", signedInUser.permissions)
            ? "pos"
            : moduleLinks.find((item) => item.permission && can(signedInUser.role, item.permission, signedInUser.permissions))?.id ?? "pos";
      setTab(landingTab);
      if (can(signedInUser.role, "pos.use", signedInUser.permissions)) {
        await refreshBootstrap();
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not load the app.");
    } finally {
      setLoading(false);
    }
  }, [refreshBootstrap]);

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
    if (tab === "pos" && can(user.role, "pos.use", user.permissions)) {
      loadProducts().catch((error: unknown) => setNotice(error instanceof Error ? error.message : "Could not load products."));
    } else if (tab === "kitchen") {
      void refreshKitchen();
    } else if (tab === "dashboard" && can(user.role, "reports.view", user.permissions)) {
      void refreshDashboard();
    } else if (tab === "reports" && can(user.role, "reports.view", user.permissions)) {
      void refreshReport();
    } else {
      const module = moduleLinks.find((item) => item.id === tab)?.resource;
      if (module) void refreshModule(module);
    }
  }, [loadProducts, loading, refreshDashboard, refreshKitchen, refreshModule, refreshReport, tab, user]);

  useEffect(() => {
    if (!user || loading || tab !== "kitchen") return;
    const interval = window.setInterval(() => {
      void refreshKitchen();
    }, 5000);
    return () => window.clearInterval(interval);
  }, [loading, refreshKitchen, tab, user]);

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
          customerName: customerName.trim(),
          tableId: orderType === "dine_in" ? Number(tableId) : null,
          items: cart.map((line) => ({ productId: line.product.id, quantity: line.quantity })),
        }),
      });
      setPaymentAmount(result.total);
      setActiveOrder(null);
      setPaymentDialogOpen(false);
      setReceipt({
        number: result.orderNumber,
        customer: customerName.trim() || "Walk-in customer",
        type: orderType === "dine_in" ? "Dine in" : "Take away",
        table: orderType === "dine_in" ? bootstrap?.tables.find((table) => String(table.id) === tableId)?.table_name ?? "—" : "—",
        lines: cart.map((line) => ({ ...line })),
        total: Number(result.total),
        currency: result.currency,
      });
      setCart([]);
      setNotice(`Order ${result.orderNumber} saved. Give the customer their receipt.`);
      setCustomerName("");
      setOrderType("take_away");
      setTableId("");
      await refreshPosViews(true);
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
      const result = await request<{ status: "paid" | "partial"; remainingDue: string }>(`/api/orders/${activeOrder.id}/payment`, {
        method: "POST",
        body: JSON.stringify({ method: paymentMethod, amount: paymentAmount, transactionRef }),
      });
      setTransactionRef("");
      if (result.status === "paid") {
        setNotice(`Payment recorded. Order ${activeOrder.number} is paid.`);
        setActiveOrder(null);
        setPaymentDialogOpen(false);
        setOrderType("take_away");
        setTableId("");
        setCustomerName("");
        await refreshPosViews(true);
        if (user && can(user.role, "reports.view", user.permissions)) await refreshDashboard();
        await refreshModule("invoice");
      } else {
        setNotice(`Payment recorded. Balance remaining: ${money(result.remainingDue, activeOrder.currency)}.`);
        setActiveOrder((current) => current
          ? { ...current, remaining: result.remainingDue }
          : current);
        setPaymentAmount(result.remainingDue);
        await refreshModule("invoice");
      }

    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not record payment.");
    } finally {
      setBusy(false);
    }
  }

  function openInvoicePayment(row: Record<string, unknown>) {
    const remaining = String(row.remaining_due ?? "0");
    setActiveOrder({
      id: Number(row.order_id),
      number: String(row.order_number ?? ""),
      total: String(row.total ?? "0"),
      remaining,
      currency: String(row.currency ?? currency),
      tableName: typeof row.table_name === "string" ? row.table_name : null,
    });
    setPaymentAmount(remaining);
    setPaymentDialogOpen(true);
  }

  async function addInvoiceItem(orderId: number, productId: number, quantity: number) {
    setBusy(true);
    try {
      await request(`/api/orders/${orderId}/items`, {
        method: "POST",
        body: JSON.stringify({ productId, quantity }),
      });
      setNotice("Item added to the order and its balance was updated.");
      await loadModule("invoice");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not add item to order.");
      throw error;
    } finally {
      setBusy(false);
    }
  }

  async function deleteSettledInvoice(row: Record<string, unknown>) {
    const invoiceId = Number(row.id);
    const invoiceNumber = String(row.invoice_number ?? "");
    if (!Number.isSafeInteger(invoiceId) || invoiceId <= 0) return;
    const confirmed = window.confirm(
      `Delete invoice ${invoiceNumber}? Its order will be voided, its recorded payments will be excluded from totals and reports, and revenue will decrease. Stock will not be restored, and this does not issue an actual refund. This action is recorded in the audit log.`,
    );
    if (!confirmed) return;
    setBusy(true);
    try {
      await request(`/api/invoices/${invoiceId}`, { method: "DELETE" });
      setNotice(`Invoice ${invoiceNumber} and its sale were removed from financial totals. The action remains in the audit log.`);
      await loadModule("invoice");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not remove invoice.");
    } finally {
      setBusy(false);
    }
  }

  async function finishReceipt() {
    setReceipt(null);
    setActiveOrder(null);
    setTab("invoice");
    setNotice("Receipt ready. The order is in the invoice list for payment.");
    await loadModule("invoice");
  }

  async function cancelOrder() {
    if (!activeOrder || !window.confirm(`Cancel order ${activeOrder.number}? This cannot be undone.`)) return;
    setBusy(true);
    setNotice("");
    try {
      await request(`/api/orders/${activeOrder.id}/cancel`, { method: "POST" });
      setActiveOrder(null);
      setPaymentDialogOpen(false);
      setOrderType("take_away");
      setTableId("");
      setCustomerName("");
      setNotice(`Order ${activeOrder.number} was cancelled.`);
      await refreshPosViews(true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not cancel order.");
    } finally {
      setBusy(false);
    }
  }

  async function advanceTicket(order: Order) {
    setBusy(true);
    setNotice("");
    try {
      await request(`/api/kitchen/${order.id}`, { method: "POST" });
      await refreshKitchen();
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

  const canReports = can(user.role, "reports.view", user.permissions);
  const visibleModules = moduleLinks.filter((item) => item.permission
    ? can(user.role, item.permission, user.permissions)
    : item.id === "reports" && can(user.role, "reports.view", user.permissions));
  const currentLabel = tab === "dashboard" ? "Dashboard" : moduleLinks.find((item) => item.id === tab)?.label ?? "Workspace";
  const dashboardDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dashboardDay = new Date().getDay();
  const chartValues = dashboardDays.map((_, day) => dashboard?.weekly.find((item) => Number(item.day) === day));
  const maxChartRevenue = Math.max(1, ...chartValues.map((item) => Number(item?.revenue ?? 0)));
  const tableTotal = Number(dashboard?.tables.total ?? 0);
  const tableBooked = Number(dashboard?.tables.occupied ?? 0);
  const bookedPercent = tableTotal ? Math.round(tableBooked / tableTotal * 100) : 0;
  const completionBase = Number(dashboard?.counters.completed ?? 0) + Number(dashboard?.counters.pending ?? 0);
  const completionPercent = completionBase ? Math.round(Number(dashboard?.counters.completed ?? 0) / completionBase * 100) : 0;
  const averageOrderValue = Number(dashboard?.counters.paid_orders ?? 0)
    ? Number(dashboard?.counters.range_revenue ?? 0) / Number(dashboard?.counters.paid_orders)
    : 0;
  const rangeLabel = dashboardPeriod === "week" ? "This Week" : "This Month";

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

      <section className={tab === "kitchen" ? "workspace kitchen-workspace" : "workspace"}>
        {tab !== "kitchen" && tab !== "audit" && <header className="topbar">
          <div><p className="eyebrow">{new Intl.DateTimeFormat(undefined, { dateStyle: "full" }).format(new Date())}</p><h1>{currentLabel}</h1></div>
          <div className="topbar-user"><span className="online-dot" />{user.fullName}<span className="role-pill">{user.role}</span></div>
        </header>}
        {notice && <div className={`notice ${notice.toLowerCase().includes("could not") || notice.toLowerCase().includes("invalid") ? "error" : ""}`} role="status">{notice}<button onClick={() => setNotice("")}>×</button></div>}

        {tab === "pos" && (
          <div className="pos-layout">
            <aside className="cart-panel">
              <div className="pos-order-meta">
                <strong><span>Order</span>New order</strong>
                <strong><span>Customer</span>{customerName.trim() || "Walk-in customer"}</strong>
                <strong><span>Type</span>{orderType === "dine_in" ? "Dine in" : "Take away"}</strong>
                <strong><span>Table</span>{orderType === "dine_in" ? bootstrap?.tables.find((table) => String(table.id) === tableId)?.table_name ?? "Not selected" : "—"}</strong>
              </div>
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
                  <button type="button" className="pos-new-button" disabled={busy} onClick={() => resetSale(true)}>＋ New</button>
                  <button type="button" className="secondary" disabled={busy || !cart.length} onClick={() => resetSale(false)}>Cancel</button>
                  <button type="button" className="primary" disabled={!cart.length || busy} onClick={() => void createOrder()}>{busy ? "Saving…" : "Save order"}</button>
                </div>
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

        {activeOrder && paymentDialogOpen && (
          <div className="payment-backdrop">
            <form className="payment-dialog" onSubmit={recordPayment}>
              <button type="button" className="dialog-close" aria-label="Close" onClick={() => setPaymentDialogOpen(false)}>×</button>
              <p className="eyebrow">ORDER {activeOrder.number}</p><h2>Record payment</h2>
              <div className="payment-total"><span>Balance due</span><strong>{money(activeOrder.remaining, activeOrder.currency)}</strong></div>
              <label>Payment method<select value={paymentMethod} onChange={(event) => { setPaymentMethod(event.target.value); setTransactionRef(""); }}><option value="cash">Cash</option><option value="m-pesa">M-Pesa</option><option value="card">Card</option><option value="bank-transfer">Bank transfer</option></select></label>
              <label>Amount applied<input inputMode="decimal" type="number" step="0.01" min="0.01" max={activeOrder.remaining} value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} required /></label>
              {paymentMethod !== "cash" && <label>{paymentMethod === "m-pesa" ? "M-Pesa confirmation code" : "Transaction reference (optional)"}<input autoComplete="off" maxLength={100} value={transactionRef} onChange={(event) => setTransactionRef(event.target.value)} placeholder={paymentMethod === "m-pesa" ? "Enter the code from the M-Pesa message" : "Enter a receipt or transaction reference"} required={paymentMethod === "m-pesa"} /></label>}
              {paymentMethod === "m-pesa" && <p className="payment-warning">Verify the payment in M-Pesa, then enter its confirmation code. No payment request is sent from this system.</p>}
              <button className="primary full" disabled={busy}>{busy ? "Recording…" : "Confirm payment"}</button>
            </form>
          </div>
        )}

        {tab === "pos" && receipt && <div className="payment-backdrop receipt-backdrop" role="dialog" aria-modal="true" aria-label="Order receipt">
          <section className="payment-dialog receipt-dialog">
            <p className="eyebrow">CUSTOMER RECEIPT</p><h2>{bootstrap?.settings.restaurantName ?? "Restaurant"}</h2>
            <p>Order {receipt.number}<br />{new Date().toLocaleString()}</p>
            <p>{receipt.customer} · {receipt.type}{receipt.table !== "—" ? ` · ${receipt.table}` : ""}</p>
            <div className="receipt-lines">{receipt.lines.map((line) => <div key={line.product.id}><span>{line.quantity} × {line.product.name}</span><span>{money(Number(line.product.price) * line.quantity, receipt.currency)}</span></div>)}</div>
            <div className="payment-total"><span>Total due after dining</span><strong>{money(receipt.total, receipt.currency)}</strong></div>
            <p>Present this receipt when you are ready to pay.</p>
            <button className="primary full" onClick={() => { window.print(); void finishReceipt(); }}>Print receipt</button>
            <button className="secondary full" onClick={() => void finishReceipt()}>Done · go to invoices</button>
          </section>
        </div>}

        {tab === "dashboard" && <section className="dashboard-page">
          <div className="dashboard-metrics">
            <article className="dashboard-metric"><div><span className="metric-icon coral">▧</span><span>Pending Orders</span></div><button aria-label="Refresh pending orders" onClick={() => void refreshDashboard()}>↗</button><strong>{Number(dashboard?.counters.pending ?? 0)}</strong><small><b>{completionPercent}%</b> cleared</small></article>
            <article className="dashboard-metric"><div><span className="metric-icon orange">♨</span><span>Orders in Progress</span></div><button aria-label="Refresh orders in progress" onClick={() => void refreshDashboard()}>↗</button><strong>{Number(dashboard?.counters.in_progress ?? 0)}</strong><small>Preparing or ready</small></article>
            <article className="dashboard-metric"><div><span className="metric-icon amber">♧</span><span>Available Tables</span></div><button aria-label="Refresh table availability" onClick={() => void refreshDashboard()}>↗</button><strong>{Number(dashboard?.tables.available ?? 0)}<i>/{tableTotal}</i></strong><small><b>{bookedPercent}%</b> booked</small></article>
          </div>

          <div className="dashboard-analysis">
            <section className="dashboard-card revenue-card">
              <div className="dashboard-card-heading"><div><h2>Total Revenue</h2><p>Paid orders · {rangeLabel.toLowerCase()}</p></div><div className="dashboard-tools"><label className="period-select"><span>▦</span><select aria-label="Revenue date range" value={dashboardPeriod} onChange={(event) => setDashboardPeriod(event.target.value as "week" | "month")}><option value="week">This Week</option><option value="month">This Month</option></select></label><button className="card-shortcut" aria-label="Refresh revenue chart" onClick={() => void refreshDashboard()}>↗</button></div></div>
              <div className="revenue-chart" role="img" aria-label={`Revenue by weekday for ${rangeLabel}`}>
                <div className="chart-axis">{[1, .8, .6, .4, .2, 0].map((mark) => <span key={mark}>{mark ? new Intl.NumberFormat(undefined, { style: "currency", currency: dashboard?.currency ?? currency, notation: "compact", maximumFractionDigits: 1 }).format(maxChartRevenue * mark) : "0"}</span>)}</div>
                <div className="chart-plot"><div className="chart-gridlines"><i /><i /><i /><i /><i /></div><div className="chart-bars">{chartValues.map((item, day) => {
                  const value = Number(item?.revenue ?? 0);
                  const height = value ? Math.max(8, value / maxChartRevenue * 100) : 4;
                  return <div className={`chart-day ${day === dashboardDay ? "current" : ""}`} key={day}>
                    <div className="chart-bar-zone"><div className="chart-bar" style={{ height: `${height}%` }} />{day === dashboardDay && <div className="chart-tooltip"><b>{money(value, dashboard?.currency ?? currency)}</b><span>Subtotal {money(Number(item?.subtotal ?? 0), dashboard?.currency ?? currency)}</span></div>}</div>
                    <span className="chart-day-label">{dashboardDays[day]}</span>
                  </div>;
                })}</div></div>
              </div>
            </section>
            <section className="dashboard-card business-card">
              <div className="dashboard-card-heading"><div><h2>Business Data</h2><p>Activity · {rangeLabel.toLowerCase()}</p></div><label className="period-select"><span>▦</span><select aria-label="Business data date range" value={dashboardPeriod} onChange={(event) => setDashboardPeriod(event.target.value as "week" | "month")}><option value="week">This Week</option><option value="month">This Month</option></select></label></div>
              <article className="business-strip lavender"><span className="business-icon">♙</span><div><small>Number of Customers</small><strong>{Number(dashboard?.counters.customers ?? 0).toLocaleString()}</strong></div><span className="strip-arrow">↗</span></article>
              <article className="business-strip peach"><span className="business-icon">▤</span><div><small>Total Orders</small><strong>{Number(dashboard?.counters.total_orders ?? 0).toLocaleString()}</strong></div><span className="strip-arrow">↗</span></article>
              <article className="business-strip mint"><span className="business-icon">{dashboard?.currency === "JPY" ? "¥" : dashboard?.currency === "KES" ? "KSh" : dashboard?.currency === "EUR" ? "€" : dashboard?.currency === "GBP" ? "£" : "$"}</span><div><small>Average Order Value</small><strong>{money(averageOrderValue, dashboard?.currency ?? currency)}</strong></div></article>
            </section>
          </div>

          <div className="dashboard-feeds">
            <section className="dashboard-card activity-card">
              <div className="dashboard-card-heading"><div><h2>Recent Activity</h2><p>Latest orders across the restaurant</p></div><button className="card-shortcut" aria-label="Refresh recent activity" onClick={() => void refreshDashboard()}>↗</button></div>
              <div className="activity-list">{dashboard?.activity.map((item) => {
                const completed = item.kitchen_status === "completed" || item.status === "paid";
                const elapsed = Math.max(0, Math.round((Date.now() - new Date(item.created_at).getTime()) / 60_000));
                return <article className="activity-row" key={item.id}>
                  <div className="food-thumb round">{item.image_path ? <img src={item.image_path} alt="" /> : <span>🍽</span>}</div>
                  <div className="activity-copy"><strong>Status Changed</strong><div><span>{money(item.total, item.currency)}</span><span>#{item.order_number.replace(/^ORD-/, "")}</span><span>◷ {elapsed < 60 ? `${elapsed} min` : `${Math.floor(elapsed / 60)} hr`}</span></div></div>
                  <span className={`activity-status ${completed ? "done" : "waiting"}`}>{completed ? "Completed" : "Pending"}</span>
                </article>;
              })}{!dashboard?.activity.length && <div className="dashboard-empty">New orders will appear here.</div>}</div>
            </section>
            <section className="dashboard-card dishes-card">
              <div className="dashboard-card-heading"><div><h2>Top Dishes</h2><p>Most ordered completed dishes</p></div><label className="period-select"><span>▦</span><select aria-label="Top dishes date range" value={dashboardPeriod} onChange={(event) => setDashboardPeriod(event.target.value as "week" | "month")}><option value="week">This Week</option><option value="month">This Month</option></select></label></div>
              <div className="dish-list">{dashboard?.dishes.map((dish) => <article className="dish-row" key={dish.id}><div className="food-thumb square">{dish.image_path ? <img src={dish.image_path} alt="" /> : <span>🍲</span>}</div><strong>{dish.name}</strong><div className="dish-count"><b>{Number(dish.completed_orders).toLocaleString()}</b><small>Orders</small></div></article>)}{!dashboard?.dishes.length && <div className="dashboard-empty">Completed dish sales will appear here.</div>}</div>
            </section>
          </div>
        </section>}

        {tab === "kitchen" && <section className="kitchen-page">
          <div className="kitchen-title"><h2>Kitchen orders display</h2><button className="secondary" onClick={() => void refreshKitchen()}>↻ Refresh</button></div>
          <div className="kitchen-board">
            {([
              ["pending", "New orders", "New"],
              ["preparing", "Preparing orders", "Processing"],
              ["ready", "Ready for pickup", "Ready"],
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
          <WorkspaceModules module="invoice" rows={moduleRows.invoice ?? []} extras={moduleExtras.invoice ?? {}} canManage={false} busy={busy} onSave={saveModule} onRefresh={() => loadModule("invoice")} canPayInvoices={can(user.role, "payments.record", user.permissions)} canAddInvoiceItems={can(user.role, "orders.create", user.permissions)} canDeleteInvoices={can(user.role, "invoices.delete", user.permissions)} onPayInvoice={openInvoicePayment} onAddInvoiceItem={addInvoiceItem} onDeleteInvoice={deleteSettledInvoice} />
        </section>}

        {tab === "reports" && <section className="page-content">
          <div className="section-heading"><div><h2>Sales performance</h2><p>Compare sales, expenses, and gross profit by currency.</p></div>
            <div className="date-filter"><label>From<input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label><label>To<input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></label><button className="primary" onClick={() => void refreshReport()}>Apply</button></div>
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
            <ReportTable title="Payment methods" headers={["Method", "Currency", "Paid"]} rows={report?.payments.map((item) => [paymentMethodLabel(item.method), item.currency, money(item.total, item.currency)]) ?? []} />
            <ReportTable title="Gross profit by product" headers={["Product", "Currency", "Gross profit"]} rows={report?.profit.map((item) => [item.name, item.currency, money(item.profit, item.currency)]) ?? []} />
          </div>
        </section>}

        {visibleModules.map((item) => item.resource && item.id !== "invoice" && tab === item.id && (
          <WorkspaceModules
            key={item.id}
            module={item.resource}
            rows={moduleRows[item.resource] ?? []}
            extras={moduleExtras[item.resource] ?? {}}
            canManage={can(user.role, ({
              product: "catalog.manage",
              category: "catalog.manage",
              inventory: "inventory.manage",
              supplier: "suppliers.manage",
              purchase: "purchases.manage",
              tables: "tables.manage",
              expense: "expenses.manage",
              users: "users.manage",
              settings: "settings.manage",
              invoice: "",
              audit: "",
            } satisfies Record<WorkspaceModule, string>)[item.resource], user.permissions)}
            busy={busy}
            onSave={saveModule}
            onFinalizePurchase={item.id === "purchase" ? finalizePurchase : undefined}
            onRefresh={() => void refreshModule(item.resource!)}
            onAuditQuery={item.resource === "audit" ? async (filters) => {
              const params = new URLSearchParams({
                action: filters.action,
                entity: filters.entity,
                user: filters.user,
                from: filters.from,
                to: filters.to,
                page: String(filters.page),
              });
              await loadModule("audit", params);
            } : undefined}
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
