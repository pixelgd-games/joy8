import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { restoreSnapshot } from './restore-snapshot.mjs';

const directory = process.argv[2];
assert.ok(directory, 'Supply a local hosted snapshot; this check never connects to hosted data');
const sql = await readFile(new URL('../supabase/migrations/20261011120000_mahjong_clear_play_data.sql', import.meta.url), 'utf8');
const quote = value => '"' + value.replaceAll('"', '""') + '"';

await restoreSnapshot(directory, async db => {
  const protectedTables = (await db.query("select schemaname,tablename from pg_tables where schemaname in ('public','auth') order by schemaname,tablename")).rows;
  const fingerprint = async table => (await db.query(`select count(*)::text as rows,md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by to_jsonb(t)::text),'')) as hash from ${quote(table.schemaname)}.${quote(table.tablename)} t`)).rows[0];
  const before = [];
  for (const table of protectedTables) before.push(await fingerprint(table));
  const blocker = await db.connect();
  try {
    await blocker.query('select pg_advisory_lock(1296123978,1)');
    await assert.rejects(db.exec(sql), /MAHJONG_CLEAR_AUTHORITY_RUNNING/);
    await db.exec('rollback');
    await blocker.query('select pg_advisory_unlock(1296123978,1)');
  } finally { await blocker.end(); }
  const matches = (await db.query('select count(*)::int as n from mahjong_clash.matches')).rows[0].n;
  await assert.rejects(db.exec(sql.replace(`('matches',${matches},`, `('matches',${matches + 1},`)), /MAHJONG_CLEAR_COUNTS_CHANGED/);
  await db.exec('rollback');
  assert.equal((await db.query('select count(*)::int as n from mahjong_clash.matches')).rows[0].n, matches);
  await db.exec(sql);
  const after = [];
  for (const table of protectedTables) after.push(await fingerprint(table));
  assert.deepEqual(after, before);
  assert.deepEqual((await db.query('select water::text,strength,risk from mahjong_clash.economy_state')).rows[0], { water: '0', strength: 'normal', risk: 'normal' });
  await db.query('select public.joy8_validate_product_adapters()');
  for (const { relname } of (await db.query("select relname from pg_class where relnamespace='mahjong_clash'::regnamespace and relkind='r' and relname not in ('economy_state','economy_versions','lifecycle_config')")).rows)
    assert.equal((await db.query(`select count(*)::int as n from mahjong_clash.${quote(relname)}`)).rows[0].n, 0, relname);
  console.log('Mahjong play-data clear passed on the local hosted snapshot: authority-lock rejection, changed-inventory rollback, play data cleared, AI state reset, all Auth/platform rows preserved, triggers and adapters valid.');
});
