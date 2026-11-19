import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import pg from 'pg';

const connectionString = process.env.TEST_DATABASE_URL;
test('tenant migration preserves records and rejects multi-tenant merges', {skip: !connectionString}, async () => {
  const admin = new pg.Client({connectionString}); await admin.connect();
  const schemas = [];
  async function fixture(multitenant) {
    const schema = 'codex_single_' + randomBytes(6).toString('hex'); schemas.push(schema);
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.query(`CREATE TABLE ${schema}.users(id text primary key,tenant text not null,password text not null)`);
    await admin.query(`CREATE TABLE ${schema}.submissions(id text primary key,tenant text not null,idem text not null,unique(tenant,idem))`);
    await admin.query(`CREATE TABLE ${schema}.audit(id int primary key,tenant text not null,action text not null)`);
    await admin.query(`INSERT INTO ${schema}.users VALUES ('u','one','preserved-hash')`);
    await admin.query(`INSERT INTO ${schema}.submissions VALUES ('s','one','request-1')`);
    await admin.query(`INSERT INTO ${schema}.audit VALUES (1,'one','login')`);
    if (multitenant) await admin.query(`INSERT INTO ${schema}.users VALUES ('v','two','other-hash')`);
    return schema;
  }
  function run(schema, args=[]) {
    return spawnSync(process.execPath, ['scripts/remove-tenant.mjs',...args], {encoding:'utf8', env:{...process.env,APP_DATABASE_URL:connectionString,APP_DATABASE_SCHEMA:schema}});
  }
  try {
    const one = await fixture(false);
    assert.equal(run(one).status, 0);
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema=$1 AND column_name=$2',[one,'tenant'])).rows[0].n,3);
    assert.equal(run(one,['--apply']).status,0);
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema=$1 AND column_name=$2',[one,'tenant'])).rows[0].n,0);
    assert.equal((await admin.query(`SELECT password FROM ${one}.users WHERE id='u'`)).rows[0].password,'preserved-hash');
    assert.equal((await admin.query(`SELECT count(*)::int AS n FROM ${one}.submissions`)).rows[0].n,1);
    assert.equal((await admin.query(`SELECT count(*)::int AS n FROM ${one}.audit`)).rows[0].n,1);
    const multi = await fixture(true);
    assert.notEqual(run(multi,['--apply']).status,0);
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema=$1 AND column_name=$2',[multi,'tenant'])).rows[0].n,3);
    assert.equal((await admin.query(`SELECT count(*)::int AS n FROM ${multi}.users`)).rows[0].n,2);
  } finally {
    for (const schema of schemas) await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
});
