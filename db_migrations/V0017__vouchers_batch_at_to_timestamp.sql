ALTER TABLE customers ALTER COLUMN vouchers_batch_at TYPE TIMESTAMP USING vouchers_batch_at::timestamp;
UPDATE customers SET vouchers_batch_at = created_at WHERE vouchers_batch_at IS NOT NULL;