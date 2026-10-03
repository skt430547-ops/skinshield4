const pool = require('./db');

async function initializeDatabase() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        product_name VARCHAR(100) NOT NULL,
        brand VARCHAR(100) NOT NULL,
        serial_number VARCHAR(100) UNIQUE NOT NULL,
        is_authentic BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      ALTER TABLE products
        ADD COLUMN IF NOT EXISTS image_url TEXT,
        ADD COLUMN IF NOT EXISTS is_doctor_approved BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS certificate_id TEXT,
        ADD COLUMN IF NOT EXISTS doctor_name TEXT,
        ADD COLUMN IF NOT EXISTS doctor_license TEXT,
        ADD COLUMN IF NOT EXISTS clinic_name TEXT,
        ADD COLUMN IF NOT EXISTS approval_date DATE
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS app_ratings (
        client_id UUID PRIMARY KEY,
        rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { initializeDatabase };
