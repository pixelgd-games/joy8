import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { after, before, test } from "node:test"
import { loadCurrentPlatform } from "./fixtures/platform-bundle.mjs"
import { createTestDatabase } from "./fixtures/test-database.mjs"

const profile = JSON.parse(await readFile(new URL("../integrations/third-party/profiles/monster-lab.json", import.meta.url), "utf8"))
const db = await createTestDatabase()
const one = async (sql, values = []) => (await db.query(sql, values)).rows[0]

before(async () => {
  await loadCurrentPlatform(db)
})

after(() => db.close())

test("Monster Lab has one hidden private integration with the approved seamless-wallet limits", async () => {
  const game = await one("select id,name,slug,type,published,launch_url from public.games where slug='monster-lab'")
  assert.deepEqual(game, {
    id: profile.game.gameId,
    name: profile.game.name,
    slug: profile.game.slug,
    type: "slot",
    published: false,
    launch_url: null
  })
  const policy = await one("select enabled,max_bet_amount,max_payout_amount,max_participants,funding_mode,product_adapter from public.joy8_game_policies where game_id=$1", [profile.game.gameId])
  assert.deepEqual(policy, {
    enabled: true,
    max_bet_amount: profile.rules.maxBetAmount,
    max_payout_amount: profile.rules.maxPayoutAmount,
    max_participants: profile.rules.maxParticipants,
    funding_mode: profile.rules.fundingMode,
    product_adapter: null
  })
  const entry = await one("select entry_origin,launch_url,enabled from public.joy8_private_entries where game_id=$1", [profile.game.gameId])
  assert.deepEqual(entry, { entry_origin: profile.platform.parentOrigins[0], launch_url: profile.game.gameUrl, enabled: false })
  assert.equal(Number((await one("select count(*) n from public.joy8_backend_keys where game_id=$1", [profile.game.gameId])).n), 0)
})

test("private activation enables only the exact unpublished Monster Lab entry", async () => {
  const isolated = await createTestDatabase()
  try {
    await loadCurrentPlatform(isolated)
    const mahjongId = "faaa45eb-7d7d-40b5-9081-3dd73482adfa"
    await isolated.query("insert into public.games(id,name,slug,type,published,launch_url) values($1,'Mahjong Clash','mahjong-clash','card',false,null)", [mahjongId])
    await isolated.query("insert into public.joy8_private_entries(game_id,entry_origin,launch_url,enabled) values($1,'http://localhost:5173','http://localhost:4391/',false)", [mahjongId])
    const migration = await readFile("supabase/migrations/20260925130000_monster_lab_private_entry_activation.sql", "utf8")
    await isolated.exec(migration)
    const entries = (await isolated.query("select g.slug,g.published,g.launch_url as catalog_url,e.enabled,e.entry_origin,e.launch_url as private_url from public.games g join public.joy8_private_entries e on e.game_id=g.id where g.slug in ('mahjong-clash','monster-lab') order by g.slug")).rows
    assert.deepEqual(entries, [
      { slug: "mahjong-clash", published: false, catalog_url: null, enabled: false, entry_origin: "http://localhost:5173", private_url: "http://localhost:4391/" },
      { slug: "monster-lab", published: false, catalog_url: null, enabled: true, entry_origin: profile.platform.parentOrigins[0], private_url: profile.game.gameUrl }
    ])
    await assert.rejects(isolated.exec(migration), /JOY8_MONSTER_LAB_ENTRY_NOT_READY/)
  } finally {
    await isolated.close()
  }
})

test("publication exposes Monster Lab and closes only its private entry", async () => {
  const isolated = await createTestDatabase()
  try {
    await loadCurrentPlatform(isolated)
    const mahjongId = "faaa45eb-7d7d-40b5-9081-3dd73482adfa"
    await isolated.query("insert into public.games(id,name,slug,type,published,launch_url) values($1,'Mahjong Clash','mahjong-clash','card',false,null)", [mahjongId])
    await isolated.query("insert into public.joy8_private_entries(game_id,entry_origin,launch_url,enabled) values($1,'http://localhost:5173','http://localhost:4391/',false)", [mahjongId])
    await isolated.exec(await readFile("supabase/migrations/20260925130000_monster_lab_private_entry_activation.sql", "utf8"))
    await isolated.query("insert into public.joy8_backend_keys(game_id,key_hash,scopes) values($1,$2,array['exchange','renew','open','settle','status','cancel'])", [profile.game.gameId, "a".repeat(64)])
    await isolated.exec(await readFile("supabase/migrations/20260925140000_publish_monster_lab.sql", "utf8"))
    const games = (await isolated.query("select g.slug,g.published,g.launch_url,e.enabled from public.games g join public.joy8_private_entries e on e.game_id=g.id where g.slug in ('mahjong-clash','monster-lab') order by g.slug")).rows
    assert.deepEqual(games, [
      { slug: "mahjong-clash", published: false, launch_url: null, enabled: false },
      { slug: "monster-lab", published: true, launch_url: profile.game.gameUrl, enabled: false }
    ])
    assert.equal(Number((await isolated.query("select count(*) n from public.public_games_v1 where slug='monster-lab'")).rows[0].n), 1)
  } finally {
    await isolated.close()
  }
})
