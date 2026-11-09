# DAN RESTAURANT POS

Python desktop point-of-sale application using PyQt6 and Neon PostgreSQL.

## Implemented modules

The current application includes login and role checks, dashboard navigation, product/category management with local image uploads, POS orders and payments, inventory movements, tables, KOT, suppliers and purchases, expenses, branded/printable invoices, reports with cashier/category/gross-profit breakdowns and Excel-compatible CSV export, users, restaurant settings, and an audit log for business changes.

M-Pesa entries remain pending; the app does not simulate or send live transactions. Sales inventory is deducted only after a recorded successful payment, and finalized purchases add stock transactionally. Product/category JPG and PNG images (up to 5 MB and 4096 × 4096 pixels) are stored under `dan_restaurant_pos\uploads`. Reports can be exported as PDF or Excel-compatible CSV. Gross-profit reporting uses each order item's cost snapshot, and business mutations are recorded in the Admin/Manager audit log.

## Start the application

From this directory, install the Python requirements and start the desktop UI:

```powershell
python -m pip install -r .\dan_restaurant_pos\requirements.txt
python .\run_app.py
```

The Neon CLI stores database connection variables in `.env.local`; this file is ignored by Git. The app uses `DATABASE_URL` with Psycopg 3 and a bounded connection pool. Do not copy connection URLs into source files or logs.

On the first app launch, an administrator PIN is generated and displayed once. Alternatively, set `ADMIN_SETUP_PIN` in a local `.env` before first launch.

## Build check and tests

`npm run build` runs Python bytecode compilation for the desktop app. Run tests with:

```powershell
python -m pytest .\dan_restaurant_pos\tests
```

Test fixtures use isolated SQLite databases; normal app execution uses Neon.
