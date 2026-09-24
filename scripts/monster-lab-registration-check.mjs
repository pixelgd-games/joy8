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
