import pg from 'pg';
import { scryptSync, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
const { Pool, types } = pg;
types.setTypeParser(20, value => Number(value));
let instance;
export function db() {
  if (instance) return instance;
  if (!process.env.APP_DATABASE_URL) throw new Error('APP_DATABASE_URL is required');
  const schema = process.env.APP_DATABASE_SCHEMA || 'abuse_reporter';
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(schema)) throw new Error('Invalid APP_DATABASE_SCHEMA');
  const pool = new Pool({ connectionString: process.env.APP_DATABASE_URL, options: `-c search_path=${schema},public`, max: 10 });
  const initialize = pool.query(`
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,role TEXT NOT NULL,password TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,csrf TEXT NOT NULL,expires BIGINT NOT NULL);
    CREATE TABLE IF NOT EXISTS login_limits(identity TEXT PRIMARY KEY,count INTEGER NOT NULL,expires BIGINT NOT NULL);
    CREATE TABLE IF NOT EXISTS submissions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,idem TEXT NOT NULL,payload TEXT NOT NULL,service_id TEXT,status TEXT NOT NULL,created BIGINT NOT NULL,UNIQUE(idem));
    CREATE TABLE IF NOT EXISTS audit(id BIGSERIAL PRIMARY KEY,actor TEXT NOT NULL,action TEXT NOT NULL,object_id TEXT,status INTEGER NOT NULL,created BIGINT NOT NULL);`);
  const prepare = sql => {
    let i = 0;
    const text = sql.replace(/\?/g, () => '$' + (++i));
    const query = async args => { await initialize; return pool.query(text, args); };
    return { get: async (...args) => (await query(args)).rows[0], all: async (...args) => (await query(args)).rows, run: async (...args) => ({ changes: (await query(args)).rowCount }) };
  };
  instance = { prepare, close: () => pool.end() };
  return instance;
}
export const opaque = () => randomBytes(32).toString('hex');
export const digest = (value) => createHash('sha256').update(value).digest('hex');
export function hashPassword(password) { const salt = randomBytes(16).toString('hex'); return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`; }
export function checkPassword(password, stored) {
  const [salt, hash] = (stored || `${'0'.repeat(32)}:${'0'.repeat(128)}`).split(':');
  const expected = Buffer.from(hash, 'hex'), actual = scryptSync(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export async function session(token) {
  if (!token) return null;
  return await db().prepare('SELECT u.id,u.email,u.name,u.role,s.csrf,s.hash FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.hash=? AND s.expires>? AND u.active=1').get(digest(token), Date.now()) || null;
}
export async function audit(user, action, id, status) { await db().prepare('INSERT INTO audit(actor,action,object_id,status,created) VALUES(?,?,?,?,?)').run(user.id, action, id || '', status, Date.now()); }
export function publicUser(u) { return { id: u.id, email: u.email, name: u.name, role: u.role }; }
