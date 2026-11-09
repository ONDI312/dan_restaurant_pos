# DAN RESTAURANT POS

Restaurant point-of-sale system with a browser-based web app for Vercel and a Windows desktop app. Both use the same Neon PostgreSQL database.

## Web app

The Next.js web app includes PIN login, role-based access, live product search, POS checkout, dine-in tables, payment recording, kitchen tickets, order history, dashboard metrics, and sales reports.

M-Pesa payments remain pending; this app does not initiate or simulate live transactions. Inventory is deducted only after a successful recorded payment.

### Deploy to Vercel

1. Import `ONDI312/dan_restaurant_pos` in Vercel.
2. Set **Root Directory** to the repository root (`.`), not `dan_restaurant_pos`.
3. Use the **Next.js** framework preset. Keep the default build/output settings; the build command is `npm run build`.
4. Before the first web deployment, run [`migrations/20261109_vercel_web.sql`](./migrations/20261109_vercel_web.sql) in the Neon SQL Editor for the production branch. This creates the web login rate-limit table and adds audit fields needed by web endpoints.
5. Add these Vercel environment variables for Production and Preview:
   - `DATABASE_URL`: Neon **pooled** connection string (hostname includes `-pooler`).
   - `SESSION_SECRET`: a private random value of at least 32 characters. Generate one locally with `python -c "import secrets; print(secrets.token_urlsafe(48))"`.
   - `DB_POOL_MAX_SIZE`: optional; defaults to `3`.
6. Deploy. Vercel redeploys when changes are pushed to the connected GitHub branch.

Never paste `.env.local` or commit database credentials, session secrets, or staff PINs. The app uses existing staff accounts in Neon; it does not create or expose a default web administrator.

### Local web development

```powershell
npm install
npm run dev
```

Set `DATABASE_URL` and `SESSION_SECRET` in the ignored root `.env.local` before opening the app.

## Windows desktop app

```powershell
python -m pip install -r .\dan_restaurant_pos\requirements.txt
python .\run_app.py
```

The desktop app retains product/category image uploads, printable and PDF receipts, expenses, purchasing, audit logs, and CSV/PDF reports. Local uploads are stored under `dan_restaurant_pos/uploads/` and are not shared with the web deployment.

## Validate

```powershell
npm run build
npm run build:desktop
python -m pytest .\dan_restaurant_pos\tests
```

GitHub Actions runs the web build plus desktop compilation and tests for pushes and pull requests targeting `main`.
