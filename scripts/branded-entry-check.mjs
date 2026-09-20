import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { readFile } from "node:fs/promises"
import { createTestDatabase } from "./fixtures/test-database.mjs"
import { loadPlatformDatabase } from "./fixtures/platform-database.mjs"

let db
let game
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
async function denied(action, pattern) {
  await db.exec("savepoint denial")
  await assert.rejects(action, pattern)
  await db.exec("rollback to savepoint denial")
}

before(async () => {
  db = await createTestDatabase()
  await loadPlatformDatabase(db)
  await db.exec(`
    create schema mahjong_clash;
    create table mahjong_clash.matches (
      id uuid primary key default gen_random_uuid(),
      status text not null
    );
    create table public.joy8_private_entries (
      game_id uuid primary key references public.games(id) on delete restrict,
      entry_origin text not null,
      launch_url text not null,
      enabled boolean not null default false
    );
    alter table public.joy8_private_entries enable row level security;
    revoke all on public.joy8_private_entries from public,anon,authenticated,service_role;
  `)
  game = (await one("select id from public.games where slug='test-game'")).id
  await db.query("update public.games set published=false,launch_url=null where id=$1", [game])
  await db.query("insert into public.joy8_private_entries(game_id,entry_origin,launch_url,enabled) values($1,'http://localhost:5173','http://localhost:4391/',true)", [game])
  await db.exec(await readFile("supabase/migrations/20260920180000_branded_game_entry.sql", "utf8"))
})

after(async () => db?.close())

test("branded entry returns only non-secret launch metadata for the exact trusted origin", async () => {
  await db.exec("set role service_role")
  const result = (await one("select public.joy8_resolve_branded_entry('test-game','http://localhost:5173') result")).result
  await db.exec("reset role")
  assert.deepEqual(result, {
    game_id: game,
    game_name: "Test game",
    launch_url: "http://localhost:4391/",
    protocol: "server-v1",
  })
  for (const table of ["player_accounts", "wallet_accounts", "wallet_transactions", "game_sessions"]) {
    assert.equal(Number((await one(`select count(*) n from public.${table}`)).n), 0)
  }
  const reports = await db.exec(await readFile("scripts/sql/branded-entry-postflight.sql", "utf8"))
  const report = reports.flatMap((item) => item.rows || []).find((row) => row.branded_entry_postflight)?.branded_entry_postflight
  assert.equal(report.resolver_installed, true)
  assert.equal(Number(report.wallets), 0)
  assert.equal(Number(report.transactions), 0)
  assert.equal(Number(report.sessions), 0)
})

test("wrong origins and inactive entries fail without leaking metadata", async () => {
  await db.exec("begin")
  await db.exec("set role service_role")
  for (const origin of [null, "http://127.0.0.1:5173", "https://evil.example"]) {
    await denied(() => one("select public.joy8_resolve_branded_entry('test-game',$1)", [origin]), /JOY8_PRIVATE_ENTRY_DENIED/)
  }
  await db.exec("reset role")
  await db.query("update public.joy8_private_entries set enabled=false where game_id=$1", [game])
  await db.exec("set role service_role")
  await denied(() => one("select public.joy8_resolve_branded_entry('test-game','http://localhost:5173')"), /JOY8_PRIVATE_ENTRY_DENIED/)
  await db.exec("reset role")
  await db.exec("rollback")
})

test("browser and game roles cannot read entry configuration or call the resolver", async () => {
  for (const role of ["anon", "authenticated"]) {
    await db.exec("begin")
    await db.exec(`set role ${role}`)
    await denied(() => one("select * from public.joy8_private_entries"), /permission denied/)
    await denied(() => one("select public.joy8_resolve_branded_entry('test-game','http://localhost:5173')"), /permission denied/)
    await db.exec("rollback")
  }
})
