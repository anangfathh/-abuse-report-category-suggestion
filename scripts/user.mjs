import { randomUUID } from 'node:crypto';
import { db, hashPassword } from '../lib/store.mjs';
import { z } from 'zod';
const [email, tenant, role = 'admin', name = email] = process.argv.slice(2);
const parsed = z.object({ email: z.email(), tenant: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/), role: z.enum(['operator','reviewer','admin']), name: z.string().min(1).max(150), password: z.string().min(12).max(128) }).safeParse({email,tenant,role,name,password:process.env.BOOTSTRAP_PASSWORD});
if (!parsed.success) { console.error('Usage: BOOTSTRAP_PASSWORD=<secret> npm run user:add -- email tenant [admin|reviewer|operator] [name]. Password min 12 karakter.'); process.exit(1); }
const id = randomUUID();
await db().prepare('INSERT INTO users(id,email,name,tenant,role,password) VALUES(?,?,?,?,?,?)').run(id,email.toLowerCase(),name,tenant,role,hashPassword(parsed.data.password));
console.log('Pengguna dibuat:',id,'role:',role,'tenant:',tenant);

await db().close();
