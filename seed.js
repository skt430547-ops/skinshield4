const pool = require('./db');

async function addProduct() {
  try {
    await pool.query(`
      INSERT INTO products (serial_number, product_name, brand, is_authentic)
      VALUES ('8901138512187', 'Glow Moisturizer', 'Glow Care', true)
      ON CONFLICT (serial_number) DO NOTHING;
    `);
    console.log('✅ Product successfully added to DB!');
  } catch (err) {
    console.error('❌ Error inserting product:', err);
  } finally {
    pool.end();
  }
}

addProduct();