const { initializeDatabase } = require('./database');
const pool = require('./db');

async function createTables() {
  try {
    await initializeDatabase();
    console.log('Database tables and columns are ready.');
  } catch (err) {
    console.error('Database initialization failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

createTables();
