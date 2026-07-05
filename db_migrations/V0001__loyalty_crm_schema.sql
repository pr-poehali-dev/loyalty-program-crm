-- Продавцы (вход по email)
CREATE TABLE IF NOT EXISTS sellers (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255) DEFAULT 'Продавец',
    created_at TIMESTAMP DEFAULT NOW()
);

-- Покупатели (первые и вторые)
CREATE TABLE IF NOT EXISTS customers (
    id SERIAL PRIMARY KEY,
    seller_id INTEGER NOT NULL REFERENCES sellers(id),
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(50) NOT NULL,
    birth DATE,
    type VARCHAR(10) NOT NULL DEFAULT 'first',
    ref_id INTEGER REFERENCES customers(id),
    temp_points INTEGER NOT NULL DEFAULT 0,
    life_points NUMERIC(6,1) NOT NULL DEFAULT 0,
    vouchers INTEGER NOT NULL DEFAULT 0,
    purchases INTEGER NOT NULL DEFAULT 1,
    joined DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customers_seller ON customers(seller_id);
CREATE INDEX IF NOT EXISTS idx_customers_ref ON customers(ref_id);

-- Демо-продавец (пароль: demo123)
INSERT INTO sellers (email, password_hash, name)
VALUES ('seller@company.ru', 'demo123', 'Демо Продавец')
ON CONFLICT (email) DO NOTHING;