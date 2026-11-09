ALTER TABLE invoices
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE invoices
    ADD COLUMN IF NOT EXISTS deleted_by BIGINT REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_invoices_active_order
    ON invoices (order_id)
    WHERE deleted_at IS NULL;
