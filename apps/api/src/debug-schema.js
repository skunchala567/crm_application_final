import mysql from 'mysql2/promise';
import 'dotenv/config';

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});

async function debug() {
  try {
    console.log('=== SHOW CREATE TABLE crm_leads ===\n');
    const [[crm_leads]] = await pool.query(`SHOW CREATE TABLE crm_leads`);
    console.log(crm_leads['Create Table']);

    console.log('\n\n=== SHOW CREATE TABLE crm_lead_source_history ===\n');
    const [[source_history]] = await pool.query(`SHOW CREATE TABLE crm_lead_source_history`);
    console.log(source_history['Create Table']);

    console.log('\n\n=== Source-Channel Relationship ===');
    console.log('Sample sources with their channels:');
    const [sources] = await pool.query(`
      SELECT DISTINCT h.source_id, s.display_name as source_name, h.channel_id, c.display_name as channel_name
      FROM crm_lead_source_history h
      JOIN crm_lead_sources s ON s.id = h.source_id
      JOIN crm_lead_channels c ON c.id = h.channel_id
      ORDER BY h.source_id, h.channel_id
      LIMIT 20
    `);

    if (sources.length > 0) {
      console.table(sources);
    } else {
      console.log('No source-channel relationships found');
    }

    console.log('\n\n=== Sources without channels ===');
    const [orphan_sources] = await pool.query(`
      SELECT DISTINCT s.id, s.display_name
      FROM crm_lead_sources s
      LEFT JOIN crm_lead_source_history h ON h.source_id = s.id
      WHERE h.source_id IS NULL
      AND s.is_active = TRUE
    `);

    if (orphan_sources.length > 0) {
      console.log('Sources with no channel assignment:');
      console.table(orphan_sources);
    } else {
      console.log('All active sources have channel assignments');
    }

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

debug();
