# DAN RESTAURANT POS

Python desktop point-of-sale application built with PyQt6 and Neon PostgreSQL.

## Features

- PIN-based login and role-based permissions
- Product/category management with local image uploads
- POS orders, payments, tables, and kitchen tickets
- Inventory, suppliers, purchases, and expenses
- Branded and printable PDF invoices
- Sales reports with cashier, category, and gross-profit breakdowns
- Excel-compatible CSV exports and business audit log

M-Pesa payments remain pending until a real payment-provider integration is configured; the app does not simulate or send live transactions. Stock is deducted only after a successful recorded payment. Product and category JPG/PNG uploads are limited to 5 MB and 4096 × 4096 pixels and stored locally under `dan_restaurant_pos/uploads/`.

## Requirements

- Python 3.13 or newer
- A Neon PostgreSQL database and `DATABASE_URL`

## Setup and run

```powershell
python -m pip install -r .\dan_restaurant_pos\requirements.txt
python .\run_app.py
```

The Neon CLI writes connection variables to the ignored root `.env.local` file. For local overrides, copy `.env.example` to `.env`. Never commit database URLs, credentials, or real administrator PINs.

On first launch, the app generates and displays a one-time administrator PIN. To set one explicitly before first launch, configure `ADMIN_SETUP_PIN` in your local environment.

## Validate

```powershell
npm run build
python -m pytest .\dan_restaurant_pos\tests
```

The build command compiles Python bytecode; it does not produce a packaged installer. Tests use isolated SQLite databases, while normal application startup uses Neon PostgreSQL.

## Continuous integration

GitHub Actions runs the compile check and test suite on pushes and pull requests targeting `main`.
