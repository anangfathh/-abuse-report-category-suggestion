import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { scryptSync, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
let instance;
export function db() {
  if (instance) return instance;
  const file = process.env.APP_DATABASE_PATH || 'data/app.sqlite3';
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  instance = new DatabaseSync(file);
  instance.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,tenant TEXT NOT NULL,role TEXT NOT NULL,password TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,csrf TEXT NOT NULL,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS login_limits(identity TEXT PRIMARY KEY,count INTEGER NOT NULL,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS submissions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,tenant TEXT NOT NULL,idem TEXT NOT NULL,payload TEXT NOT NULL,service_id TEXT,status TEXT NOT NULL,created INTEGER NOT NULL,UNIQUE(tenant,idem));
    CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,actor TEXT NOT NULL,tenant TEXT NOT NULL,action TEXT NOT NULL,object_id TEXT,status INTEGER NOT NULL,created INTEGER NOT NULL);`);
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
export function session(token) {
  if (!token) return null;
  return db().prepare('SELECT u.id,u.email,u.name,u.tenant,u.role,s.csrf,s.hash FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.hash=? AND s.expires>? AND u.active=1').get(digest(token), Date.now()) || null;
}
export function audit(user, action, id, status) { db().prepare('INSERT INTO audit(actor,tenant,action,object_id,status,created) VALUES(?,?,?,?,?,?)').run(user.id, user.tenant, action, id || '', status, Date.now()); }
export function publicUser(u) { return { id: u.id, email: u.email, name: u.name, role: u.role, tenant: u.tenant }; }
