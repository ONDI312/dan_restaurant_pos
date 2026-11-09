ALTER TABLE payments
    DROP CONSTRAINT IF EXISTS payments_method_check;

ALTER TABLE payments
    ADD CONSTRAINT payments_method_check
    CHECK (method IN ('cash', 'card', 'm-pesa', 'bank-transfer', 'other'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_mpesa_transaction_ref
    ON payments (lower(btrim(transaction_ref)))
    WHERE method = 'm-pesa' AND transaction_ref IS NOT NULL AND btrim(transaction_ref) <> '';
