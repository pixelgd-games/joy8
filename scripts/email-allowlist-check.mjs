import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { after, before, test } from "node:test"
import { loadPreAllowlistPlatform } from "./fixtures/platform-bundle.mjs"
import { createTestDatabase } from "./fixtures/test-database.mjs"

const db = await createTestDatabase()
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
let admin, player, guest
before(async () => {
  await loadPreAllowlistPlatform(db)
  await db.exec("insert into public.admin_users(email) values('admin@example.test')")
  admin = (await one("insert into auth.users(email,email_confirmed_at) values('admin@example.test',now()) returning id")).id
  player = (await one("insert into auth.users(email,email_confirmed_at) values('Player@Example.test',now()) returning id")).id
  guest = (await one("insert into auth.users(is_anonymous) values(true) returning id")).id
  await db.query("insert into auth.identities values($1,'google'),($2,'google')", [admin, player])
  await db.exec(await readFile("supabase/migrations/20260927100000_email_play_allowlist.sql", "utf8"))
  await db.exec("insert into public.joy8_game_policies(game_id,wallet_policy_id,enabled,max_bet_amount,max_payout_amount,funding_mode) select g.id,p.id,true,10000,100000,'platform' from public.games g cross join public.joy8_wallet_policies p where g.slug='test-game'")
})
after(() => db.close())

test("Auth hook denies guests, wrong providers and unknown emails under its real invoker role", async () => {
  await db.exec("set role supabase_auth_admin")
  try {
    for (const [user, code] of [
      [{ is_anonymous: true }, "JOY8_GUEST_DISABLED"],
      [{ email: "admin@example.test", app_metadata: { provider: "email" } }, "JOY8_EMAIL_NOT_ALLOWED"],
      [{ email: "unknown@example.test", app_metadata: { provider: "google" } }, "JOY8_EMAIL_NOT_ALLOWED"],
      [{ email: " ADMIN@EXAMPLE.TEST ", app_metadata: { provider: "google" } }, null],
    ]) {
      const { result } = await one("select public.joy8_before_user_created($1::jsonb) result", [JSON.stringify({ user })])
      assert.equal(result.error?.message ?? null, code)
    }
  } finally { await db.exec("reset role") }
})

test("enrollment and the database session issuer deny nonmembers and immediately honor removal", async () => {
  await assert.rejects(one("select public.joy8_assert_play_access($1)", [guest]), /JOY8_GUEST_DISABLED/)
  await assert.rejects(one("select * from public.joy8_resolve_member($1,true)", [guest]), /JOY8_GUEST_DISABLED/)
  await assert.rejects(one("select * from public.joy8_resolve_member($1,true)", [player]), /JOY8_EMAIL_NOT_ALLOWED/)
  await db.exec("insert into public.joy8_email_allowlist(email) values('player@example.test')")
  await one("select * from public.joy8_resolve_member($1,true)", [player])
  assert.ok((await one("select * from public.create_game_session('test-game',$1)", [player])).session_id)
  await db.exec("delete from public.joy8_email_allowlist where email='player@example.test'")
  await assert.rejects(one("select * from public.create_game_session('test-game',$1)", [player]), /JOY8_EMAIL_NOT_ALLOWED/)
})

test("only verified Google administrators manage the list and administrator removal is refused", async () => {
  for (const role of ["anon", "authenticated", "service_role"]) {
    await db.exec(`set role ${role}`)
    await assert.rejects(one("select public.joy8_before_user_created('{}')"), /permission denied/)
    await db.exec("reset role")
  }
  await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)", [admin, JSON.stringify({ app_metadata: { provider: "google" } })])
  await db.exec("set role authenticated")
  assert.equal((await one("select public.is_joy8_admin() allowed")).allowed, true)
  await db.exec("insert into public.joy8_email_allowlist(email) values('tester@example.test')")
  await db.exec("delete from public.joy8_email_allowlist where email='tester@example.test'")
  await assert.rejects(db.exec("delete from public.joy8_email_allowlist where email='admin@example.test'"), /JOY8_ADMIN_EMAIL_REQUIRED/)
  await db.exec("reset role")
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [player])
  await db.exec("set role authenticated")
  assert.deepEqual((await db.query("select * from public.joy8_email_allowlist")).rows, [])
  await assert.rejects(db.exec("insert into public.joy8_email_allowlist(email) values('intruder@example.test')"), /row-level security/)
  await db.exec("reset role")
})
