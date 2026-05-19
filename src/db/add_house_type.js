// Run once: node src/db/add_house_type.js
require('dotenv').config();
const { pool } = require('./pool');

(async () => {
  const client = await pool.connect();
  try {
    await client.query(`
      ALTER TABLE properties
      ADD COLUMN IF NOT EXISTS house_type VARCHAR(100);
    `);
    console.log('✅  house_type column added to properties.');
  } catch (err) {
    console.error('❌  Migration failed:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
})();
