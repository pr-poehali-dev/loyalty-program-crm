-- Магазины (справочник)
CREATE TABLE IF NOT EXISTS shops (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Продавцы: логин по телефону, привязка к магазину
ALTER TABLE sellers
    ADD COLUMN IF NOT EXISTS phone VARCHAR(20) NULL,
    ADD COLUMN IF NOT EXISTS shop_id INTEGER NULL REFERENCES shops(id);

CREATE UNIQUE INDEX IF NOT EXISTS sellers_phone_idx ON sellers (phone) WHERE phone IS NOT NULL;

ALTER TABLE sellers DROP CONSTRAINT IF EXISTS sellers_email_key;

-- Приглашения больше не используются — все продавцы сразу активны
UPDATE sellers SET status = 'active' WHERE status = 'invited';
