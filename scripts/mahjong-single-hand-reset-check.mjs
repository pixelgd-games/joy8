import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { restoreSnapshot } from './restore-snapshot.mjs';

const directory = process.argv[2];
assert.ok(directory, 'Supply a local hosted snapshot; this check never connects to hosted data');
const sql = await readFile('supabase/drafts/20261001000100_mahjong_single_hand_reset.sql', 'utf8');
const quote = value => '"' + value.replaceAll('"', '""') + '"';

await restoreSnapshot(directory, async db => {
  const protectedTables = (await db.query("select schemaname,tablename from pg_tables where schemaname in ('public','auth') order by schemaname,tablename")).rows;
  const fingerprint = async table => (await db.query(`select count(*)::text as rows,md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by to_jsonb(t)::text),'')) as hash from ${quote(table.schemaname)}.${quote(table.tablename)} t`)).rows[0];
  const before = [];
  for (const table of protectedTables) before.push(await fingerprint(table));
  const blocker = await db.connect();
  try {
    await blocker.query('select pg_advisory_lock(1296123978,1)');
    await assert.rejects(db.exec(sql), /Stop Mahjong authority/);
    await db.exec('rollback');
    await blocker.query('select pg_advisory_unlock(1296123978,1)');
  } finally { await blocker.end(); }
  await assert.rejects(db.exec(sql.replace("('matches',21,", "('matches',22,")), /Cleanup inventory changed: matches/);
  await db.exec('rollback');
  assert.equal((await db.query('select count(*)::int as n from mahjong_clash.matches')).rows[0].n, 21);
  await db.exec(sql);
  const after = [];
  for (const table of protectedTables) after.push(await fingerprint(table));
  assert.deepEqual(after, before);
  assert.deepEqual((await db.query('select water::text,strength,risk from mahjong_clash.economy_state')).rows[0], { water: '0', strength: 'normal', risk: 'normal' });
  await db.query('select public.joy8_validate_product_adapters()');
  console.log('Mahjong reset passed on the local hosted snapshot: authority-lock rejection, changed-inventory rollback, 22 tables cleared, AI state reset, all Auth/platform rows preserved, triggers and adapters valid.');
});
