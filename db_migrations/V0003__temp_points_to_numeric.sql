ALTER TABLE customers
    ALTER COLUMN temp_points TYPE NUMERIC(8,1) USING temp_points::numeric(8,1);