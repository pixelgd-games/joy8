import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { createTestDatabase } from "./fixtures/test-database.mjs"
import { loadPlatformDatabase } from "./fixtures/platform-database.mjs"
import { memberSql } from "./fixtures/member-database.mjs"

const db = await createTestDatabase()
const one = async sql => (await db.query(sql)).rows[0]
let cleanup
const retained = ["8cd34776-7803-47a7-b0b8-1754eb9128f0", "ac5cb167-7cdc-4e49-ba50-47a8a5220b88"]

before(async () => {
  await loadPlatformDatabase(db)
  await db.exec(`
    create table auth.sessions(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users on delete cascade);
    create table auth.identities(user_id uuid references auth.users on delete cascade);
    create table auth.flow_state(user_id uuid);
    create table auth.refresh_tokens(user_id text);
    create table auth.scim_users(user_id uuid references auth.users on delete set null);
    create table public.admin_users(id uuid primary key);
    create table public.gateway_rate_limits(key text primary key);
    insert into public.gateway_rate_limits values('cleanup-test');
    create schema mahjong_clash;
    create table mahjong_clash.matches(id uuid);
    create table mahjong_clash.economy_state(singleton boolean primary key);
    insert into mahjong_clash.economy_state values(true);
    insert into auth.users(id) values('${retained[0]}'),('${retained[1]}');
    insert into auth.users select gen_random_uuid(),true,null,null,null from generate_series(1,11);
    insert into public.admin_users values('${retained[1]}');
    insert into auth.sessions(user_id) select id from auth.users;
    insert into auth.identities select id from auth.users;
    insert into auth.refresh_tokens select id::text from auth.users;
    insert into auth.flow_state select id from auth.users;
    insert into auth.scim_users select id from auth.users;
    insert into public.player_accounts(account_type) select 'guest' from generate_series(1,1205);
  `)
  const hash = (await one("select md5(string_agg(id::text||':'||public_id,',' order by id)) hash from public.player_accounts")).hash
  cleanup = (await memberSql("../../supabase/migrations/20260920130000_clear_prelaunch_player_data.sql"))
    .replace("60f2e0138b654acba091b9146f37b031", hash)
})
after(() => db.close())

async function rejected(sql) {
  await assert.rejects(db.exec(sql), /JOY8_PLAYER_CLEANUP/)
  await db.exec("rollback")
  assert.equal((await one("select count(*)::int n from public.player_accounts")).n, 1205)
  assert.equal((await one("select count(*)::int n from auth.users")).n, 13)
}

test("changed player inventory or missing retained account aborts before deletion", async () => {
  await rejected(cleanup.replace("<>1205", "<>1206"))
  await rejected(cleanup.replace(retained[0], "00000000-0000-0000-0000-000000000000"))
})

test("unexpected gameplay prevents cleanup instead of cascading into unreviewed records", async () => {
  await db.exec("insert into mahjong_clash.matches values(gen_random_uuid())")
  try { await rejected(cleanup) } finally { await db.exec("delete from mahjong_clash.matches") }
})

test("cleanup preserves both Auth identities, sessions, admin and catalog while removing other identities and players", async () => {
  const games = (await db.query("select * from public.games order by id")).rows
  await db.exec(cleanup)
  assert.equal((await one("select count(*)::int n from public.player_accounts")).n, 0)
  assert.deepEqual((await db.query("select id from auth.users order by id")).rows.map(r => r.id), retained)
  for (const table of ["sessions", "identities", "refresh_tokens", "scim_users"]) {
    assert.equal((await one(`select count(*)::int n from auth.${table}`)).n, 2)
  }
  assert.equal((await one("select count(*)::int n from auth.flow_state")).n, 0)
  assert.equal((await one("select count(*)::int n from public.gateway_rate_limits")).n, 0)
  assert.equal((await one("select count(*)::int n from public.admin_users")).n, 1)
  assert.equal((await one("select count(*)::int n from mahjong_clash.economy_state")).n, 1)
  assert.deepEqual((await db.query("select * from public.games order by id")).rows, games)
})
