# DAN RESTAURANT POS

Restaurant point-of-sale system with a browser-based web app for Vercel and a Windows desktop app. Both use the same Neon PostgreSQL database.

## Web app

The Next.js web app includes PIN login, role-based access, a role-appropriate landing page (Dashboard for administrators and managers, POS for other staff, and KOT for kitchen staff), POS checkout, product and category management, inventory adjustments, suppliers and purchases, expenses, tables, user and settings management, invoices, audit history, kitchen tickets, and sales reports. Product photos upload to a private Neon Object Storage bucket and are served with short-lived signed URLs.

Product photos must be JPEG, PNG, or WebP and no larger than 4 MB. M-Pesa payments remain pending; this app does not initiate or simulate live transactions. Inventory is deducted only after a successful recorded payment.

### Deploy to Vercel

1. Import `ONDI312/dan_restaurant_pos` in Vercel.
2. Set **Root Directory** to the repository root (`.`), not `dan_restaurant_pos`.
3. Use the **Next.js** framework preset. Keep the default build/output settings; the build command is `npm run build`.
4. For a fresh database, apply [`migrations/20261109_vercel_web.sql`](./migrations/20261109_vercel_web.sql) and [`migrations/20261109_workspace_modules.sql`](./migrations/20261109_workspace_modules.sql) to the production Neon branch. Both migrations are already applied to this project's production branch.
5. Run `neon deploy --branch production` from the linked project root to provision the private product-photo bucket declared in `neon.ts`.
6. Pull the production storage variables locally with `neon env pull --branch production --file .env.production.local --service object-storage`. Add these values to Vercel without committing or sharing the local env file.
7. Add these Vercel environment variables for each deployment that uses the production Neon branch:
   - `DATABASE_URL`: Neon **pooled** connection string (hostname includes `-pooler`).
   - `SESSION_SECRET`: a private random value of at least 32 characters. Generate one locally with `python -c "import secrets; print(secrets.token_urlsafe(48))"`.
   - `DB_POOL_MAX_SIZE`: optional; defaults to `3`.
   - `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_ENDPOINT_URL_S3`, and `AWS_REGION`: the production branch's values from the Neon env pull above. Use branch-matched storage credentials for any deployment connected to a different Neon branch.
8. Deploy. Vercel redeploys when changes are pushed to the connected GitHub branch.

Never paste `.env.local` or commit database credentials, session secrets, or staff PINs. The app uses existing staff accounts in Neon; it does not create or expose a default web administrator.

### Local web development

```powershell
npm install
npm run dev
```

Set `DATABASE_URL`, `SESSION_SECRET`, and the four `AWS_*` values for the same Neon branch in the ignored root `.env.local` before opening the app.

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
