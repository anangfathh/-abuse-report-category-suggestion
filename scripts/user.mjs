import { randomUUID } from 'node:crypto';
import { db, hashPassword } from '../lib/store.mjs';
import { z } from 'zod';
const [email, role = 'admin', name = email] = process.argv.slice(2);
const parsed = z.object({ email: z.email(), role: z.enum(['operator','reviewer','admin']), name: z.string().min(1).max(150), password: z.string().min(12).max(128) }).safeParse({email,role,name,password:process.env.BOOTSTRAP_PASSWORD});
if (!parsed.success) { console.error('Usage: BOOTSTRAP_PASSWORD=<secret> npm run user:add -- email [admin|reviewer|operator] [name]. Password min 12 karakter.'); process.exit(1); }
const id = randomUUID();
await db().prepare('INSERT INTO users(id,email,name,role,password) VALUES(?,?,?,?,?)').run(id,email.toLowerCase(),name,role,hashPassword(parsed.data.password));
console.log('Pengguna dibuat:',id,'role:',role);

await db().close();
