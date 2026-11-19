// Run with writers stopped and a verified database backup. Without --apply this is a dry run.
import pg from 'pg';
const schema = process.env.APP_DATABASE_SCHEMA || 'abuse_reporter';
if (!/^[a-z_][a-z0-9_]{0,62}$/.test(schema)) throw new Error('Invalid APP_DATABASE_SCHEMA');
if (!process.env.APP_DATABASE_URL) throw new Error('APP_DATABASE_URL is required');
const client = new pg.Client({connectionString: process.env.APP_DATABASE_URL, options: `-c search_path=${schema},public`});
await client.connect();
try {
  await client.query('BEGIN');
  await client.query('LOCK TABLE users, submissions, audit IN ACCESS EXCLUSIVE MODE');
  const t = await client.query('SELECT count(DISTINCT tenant)::int AS n FROM (SELECT tenant FROM users UNION ALL SELECT tenant FROM submissions UNION ALL SELECT tenant FROM audit) AS previous_tenants');
  if (t.rows[0].n > 1) throw new Error('More than one existing tenant; refusing to merge data automatically');
  const dup = await client.query('SELECT count(*)::int AS n FROM (SELECT idem FROM submissions GROUP BY idem HAVING count(*) > 1) AS conflicts');
  if (dup.rows[0].n) throw new Error('Conflicting submission idempotency keys; migration stopped');
  if (!process.argv.includes('--apply')) {
    console.log('Dry run passed. No data changed.');
    await client.query('ROLLBACK');
  } else {
    await client.query('ALTER TABLE users DROP COLUMN tenant');
    await client.query('ALTER TABLE submissions DROP COLUMN tenant');
    await client.query('ALTER TABLE submissions ADD CONSTRAINT submissions_idem_key UNIQUE (idem)');
    await client.query('ALTER TABLE audit DROP COLUMN tenant');
    await client.query('COMMIT');
    console.log('Tenant columns removed; account, submission and audit rows retained.');
  }
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally { await client.end(); }
