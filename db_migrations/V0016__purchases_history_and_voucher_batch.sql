CREATE TABLE IF NOT EXISTS purchases (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    product_name VARCHAR(255),
    purchase_amount NUMERIC(12,2),
    purchase_date DATE NOT NULL DEFAULT CURRENT_DATE,
    vouchers_granted INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_purchases_customer ON purchases(customer_id);

-- Переносим уже существующую (первую) покупку каждого покупателя в историю
INSERT INTO purchases (customer_id, product_name, purchase_amount, purchase_date, vouchers_granted, created_at)
SELECT id, product_name, purchase_amount, COALESCE(purchase_date, joined), vouchers, created_at
FROM customers
WHERE NOT EXISTS (SELECT 1 FROM purchases WHERE purchases.customer_id = customers.id);

ALTER TABLE customers ADD COLUMN IF NOT EXISTS vouchers_batch_at DATE;
UPDATE customers SET vouchers_batch_at = COALESCE(purchase_date, joined) WHERE vouchers_batch_at IS NULL;