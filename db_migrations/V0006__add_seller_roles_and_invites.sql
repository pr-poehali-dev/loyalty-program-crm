-- Роли и статусы продавцов, поддержка приглашений
ALTER TABLE sellers
    ADD COLUMN IF NOT EXISTS role VARCHAR(10) NOT NULL DEFAULT 'seller',
    ADD COLUMN IF NOT EXISTS status VARCHAR(10) NOT NULL DEFAULT 'active',
    ADD COLUMN IF NOT EXISTS invite_token VARCHAR(64) NULL,
    ADD COLUMN IF NOT EXISTS invited_at TIMESTAMP NULL,
    ADD COLUMN IF NOT EXISTS activated_at TIMESTAMP NULL;

-- role: 'admin' | 'seller'
-- status: 'invited' (ждёт активации, пароль ещё не задан) | 'active' | 'blocked'

CREATE UNIQUE INDEX IF NOT EXISTS sellers_invite_token_idx ON sellers (invite_token) WHERE invite_token IS NOT NULL;

-- Существующие продавцы с уже заданным паролем считаются активными
UPDATE sellers SET status = 'active' WHERE status IS NULL OR status = '';

-- Назначаем первого существующего продавца админом (демо-аккаунт)
UPDATE sellers SET role = 'admin' WHERE id = (SELECT MIN(id) FROM sellers);