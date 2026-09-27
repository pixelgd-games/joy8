import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { after, before, test } from "node:test"
import { loadCurrentPlatform } from "./fixtures/platform-bundle.mjs"
import { loadProductAccounting } from "./fixtures/product-accounting.mjs"
import { createTestDatabase } from "./fixtures/test-database.mjs"

const db = await createTestDatabase()
const one = async sql => (await db.query(sql)).rows[0]
const game = "faaa45eb-7d7d-40b5-9081-3dd73482adfa"
const key = "a2eeea4b-026b-4e32-bfd8-1d75223ad92b"
const draft = async path => (await readFile(path, "utf8")).replaceAll("mahjong_clash.platform_accounting", "fixture_product.accounting")
before(async () => {
  await loadCurrentPlatform(db)
  await loadProductAccounting(db)
  await db.exec(`insert into public.games(id,slug,name,type,published) values('${game}','mahjong-clash','Mahjong','card',false);
    insert into public.joy8_game_policies(game_id,wallet_policy_id,enabled,max_bet_amount,max_payout_amount,reservation_mode,max_reserve_amount,funding_mode,product_adapter)
      select '${game}',id,true,1,1,'full_balance',1,'participants','fixture_product.accounting(text,uuid,jsonb)'::regprocedure from public.joy8_wallet_policies;
    insert into public.joy8_backend_keys(id,game_id,key_hash,scopes) values('${key}','${game}',public.joy8_hash_secret('fixture-secret'),array['exchange','renew'])`)
})
after(() => db.close())

test("reserve removal retains full-balance and does not silently expand key or payout authority", async () => {
  await db.exec(await draft("supabase/migrations/20260927120000_mahjong_release_reserve.sql"))
  assert.deepEqual(await one(`select reservation_mode,max_reserve_amount,max_payout_amount from public.joy8_game_policies where game_id='${game}'`),
    { reservation_mode: "full_balance", max_reserve_amount: null, max_payout_amount: "1.00" })
  assert.deepEqual((await one(`select scopes from public.joy8_backend_keys where id='${key}'`)).scopes, ["exchange", "renew"])
})

test("scope approval refuses identity-only policy and preserves key material after funded-policy review", async () => {
  const source = await draft("supabase/migrations/20260927121000_mahjong_reviewed_key_scopes.sql")
  await assert.rejects(db.exec(source), /JOY8_MAHJONG_FUNDED_POLICY_REVIEW_REQUIRED/)
  await db.exec("rollback")
  const hash = (await one(`select key_hash from public.joy8_backend_keys where id='${key}'`)).key_hash
  await db.exec(await draft("supabase/migrations/20260927120500_mahjong_payout_safety_limit.sql"))
  assert.equal((await one(`select max_payout_amount from public.joy8_game_policies where game_id='${game}'`)).max_payout_amount, "100000000.00")
  await db.exec(source)
  assert.deepEqual(await one(`select key_hash,scopes from public.joy8_backend_keys where id='${key}'`),
    { key_hash: hash, scopes: ["exchange", "renew", "open", "settle", "status", "cancel"] })
  assert.equal((await one(`select published from public.games where id='${game}'`)).published, false)
})
