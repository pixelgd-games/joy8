import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { createTestDatabase } from "./fixtures/test-database.mjs"
import { loadCurrentPlatform } from "./fixtures/platform-bundle.mjs"

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
  await loadCurrentPlatform(db)
  game = (await one("select id from public.games where slug='test-game'")).id
  await db.query("update public.games set published=false,launch_url=null where id=$1", [game])
  await db.query("insert into public.joy8_private_entries(game_id,entry_origin,launch_url,enabled) values($1,'http://localhost:5173','http://localhost:4391/',true)", [game])
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
  assert.equal((await one("select to_regprocedure('public.joy8_resolve_branded_entry(text,text)') is not null installed")).installed, true)
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
