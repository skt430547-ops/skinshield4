const pool = require('./db');

const createTables = async () => {
  const queryText = `
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      product_name VARCHAR(100) NOT NULL,
      brand VARCHAR(100) NOT NULL,
      serial_number VARCHAR(100) UNIQUE NOT NULL,
      is_authentic BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  try {
    await pool.query(queryText);
    console.log('Products table created successfully!');
  } catch (err) {
    console.error('Error creating table:', err.stack);
  } finally {
    pool.end();
  }
};

createTables();