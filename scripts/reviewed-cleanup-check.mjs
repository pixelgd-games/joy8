import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { after, before, test } from "node:test"
import { loadPreAllowlistPlatform } from "./fixtures/platform-bundle.mjs"
import { createTestDatabase } from "./fixtures/test-database.mjs"

const db = await createTestDatabase()
const admin = "ac5cb167-7cdc-4e49-ba50-47a8a5220b88"
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
let source
before(async () => {
  await loadPreAllowlistPlatform(db)
  await db.exec(`insert into auth.users(id,email,email_confirmed_at) values('${admin}','pixelgd.games@gmail.com',now());
    insert into auth.identities values('${admin}','google');
    alter table auth.identities add foreign key(user_id) references auth.users(id) on delete cascade;
    insert into public.admin_users values('pixelgd.games@gmail.com');
    create table auth.sessions(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users on delete cascade);
    create table auth.refresh_tokens(id uuid default gen_random_uuid(),user_id text);
    create table auth.flow_state(id uuid default gen_random_uuid(),user_id uuid);
    create table auth.mfa_amr_claims(id uuid default gen_random_uuid(),session_id uuid references auth.sessions on delete cascade);
    insert into auth.sessions(user_id) values('${admin}');
    insert into auth.refresh_tokens(user_id) values('${admin}');
    insert into auth.flow_state(user_id) values('${admin}')`)
  const player = (await one("insert into auth.users(is_anonymous) values(true) returning id")).id
  await one("select * from public.joy8_resolve_member($1,true)", [player])
  const game = (await one("select id from public.games where slug='test-game'")).id
  const policy = (await one("select id from public.joy8_wallet_policies")).id
  const key = "a".repeat(64)
  await db.query("insert into public.joy8_game_policies(game_id,wallet_policy_id,enabled,max_bet_amount,max_payout_amount,funding_mode) values($1,$2,true,10000,100000,'platform')", [game, policy])
  await db.query("insert into public.joy8_backend_keys(game_id,key_hash,scopes) values($1,public.joy8_hash_secret($2),array['exchange','open','settle'])", [game, key])
  const session = await one("select * from public.create_game_session('test-game',$1)", [player])
  await db.query("select public.joy8_server_session_v1($1,'exchange',$2::jsonb)", [key, JSON.stringify({ version: 1, launch_code: session.launch_code })])
  await db.query("select public.joy8_open_match_v1($1,$2::jsonb)", [key, JSON.stringify({ version: 1, match_ref: "cleanup-fixture", rule_version: "v1", participants: [{ session_id: session.session_id, reserve: "10.00" }] })])
  await db.query("select public.joy8_settle_match_v1($1,$2::jsonb)", [key, JSON.stringify({ version: 1, match_ref: "cleanup-fixture", rule_version: "v1", operation_key: "cleanup:1", settlement_no: 1, final: true, entries: [{ kind: "player", account_ref: session.player_account_id, amount: "-10.00", source: "gameplay" }] })])
  await db.query("insert into auth.sessions(user_id) values($1)", [player])
  await db.query("insert into auth.refresh_tokens(user_id) values($1)", [player])
  await db.query("insert into auth.flow_state(user_id) values($1)", [player])
  await db.exec("insert into auth.mfa_amr_claims(session_id) select id from auth.sessions")
  await db.exec(await readFile("supabase/migrations/20260927100000_email_play_allowlist.sql", "utf8"))
  const snapshot = (await db.query((await readFile("scripts/sql/whitelist-cleanup-snapshot.sql", "utf8")).replace("begin read only;", "").replace("commit;", ""))).rows[0].snapshot
  source = (await readFile("supabase/migrations/20260927110000_clear_reviewed_test_players.sql", "utf8"))
    .replace(/expected jsonb:='.*?'::jsonb;/, `expected jsonb:='${JSON.stringify(snapshot)}'::jsonb;`)
})
after(() => db.close())

test("reviewed cleanup refuses changed data without deleting anything", async () => {
  await db.exec("insert into auth.flow_state(user_id) values(null)")
  await assert.rejects(db.exec(source), /JOY8_CLEANUP_SNAPSHOT_CHANGED/)
  await db.exec("rollback")
  assert.equal((await one("select count(*)::int n from public.player_accounts")).n, 1)
  await db.exec("delete from auth.flow_state where user_id is null")
})

test("ordered cleanup preserves the administrator and restores immutable ledger protection", async () => {
  await db.exec(source)
  assert.deepEqual((await db.query("select id from auth.users")).rows, [{ id: admin }])
  assert.equal((await one("select count(*)::int n from auth.sessions")).n, 1)
  assert.equal((await one("select count(*)::int n from auth.refresh_tokens")).n, 1)
  assert.equal((await one("select count(*)::int n from auth.mfa_amr_claims")).n, 1)
  assert.equal((await one("select count(*)::int n from public.joy8_match_participants")).n, 0)
  assert.equal((await one("select count(*)::int n from public.games")).n, 4)
  assert.equal((await one("select count(*)::int n from pg_trigger where tgname in ('joy8_wallet_transactions_immutable','joy8_settlement_entries_immutable','joy8_settlements_immutable') and tgenabled='O'")).n, 3)
})
