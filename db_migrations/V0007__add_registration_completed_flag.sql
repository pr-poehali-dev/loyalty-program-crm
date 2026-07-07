ALTER TABLE customers
    ADD COLUMN IF NOT EXISTS registration_completed BOOLEAN NOT NULL DEFAULT false;