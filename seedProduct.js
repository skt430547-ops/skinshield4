const pool = require('./db');

const seedProducts = async () => {
  try {
    // 1. Table-e image_url column na thakle add korbe
    await pool.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT;');

    // 2. Original products-er sample high-quality photo URL shoho insert/update
    await pool.query(`
      INSERT INTO products (product_name, brand, serial_number, is_authentic, image_url) 
      VALUES 
      ('Glow Moisturizer', 'SkinShield Care', 'SKIN101', true, 'https://images.unsplash.com/photo-1608248597309-122e173e44fb?w=500'),
      ('Sunscreen Gel SPF50', 'DermaGuard', 'SKIN102', true, 'https://images.unsplash.com/photo-1598440947619-2c35fc9aa908?w=500'),
      ('Fake Serum 30ml', 'Unknown Brand', 'FAKE999', false, null)
      ON CONFLICT (serial_number) 
      DO UPDATE SET image_url = EXCLUDED.image_url, is_authentic = EXCLUDED.is_authentic;
    `);

    console.log('Database updated with sample product images successfully!');
  } catch (err) {
    console.error('Error seeding products:', err.message);
  } finally {
    pool.end();
  }
};

seedProducts();