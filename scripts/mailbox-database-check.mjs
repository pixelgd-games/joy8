import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { after, before, test } from "node:test"
import { createTestDatabase } from "./fixtures/test-database.mjs"
import { loadMemberPlatformDatabase, reserveMemberWallet } from "./fixtures/member-platform.mjs"

const db = await createTestDatabase()
const one = async (sql, args = [], connection = db) => (await connection.query(sql, args)).rows[0]
let game, keys, adminId
before(async () => {
  ;({ game, keys } = await loadMemberPlatformDatabase(db))
  await db.exec("update public.joy8_wallet_policies set initial_credit=1000,guest_initial_credit=1000")
  adminId = (await one("insert into auth.users(email,email_confirmed_at) values('mail-admin@example.test',now()) returning id")).id
  await db.query("insert into auth.identities values($1,'google')", [adminId])
  await db.exec("insert into public.admin_users(email) values('mail-admin@example.test')")
  await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)", [adminId, JSON.stringify({ app_metadata: { provider: "google" } })])
})
after(() => db.close())

async function admin(action, request, connection = db) {
  await connection.query("set role authenticated")
  try { return (await one("select public.joy8_admin_mail($1,$2) result", [action, request], connection)).result }
  finally { await connection.query("reset role") }
}
async function member(player, action, request = {}, connection = db) {
  await connection.query("set role service_role")
  try { return (await one("select public.joy8_member_mail($1,$2,$3) result", [player.auth, action, request], connection)).result }
  finally { await connection.query("reset role") }
}
async function player(launch = false) {
  const auth = (await one("insert into auth.users(is_anonymous) values(true) returning id")).id
  const p = await one("select * from public.joy8_resolve_member_profile($1,true)", [auth])
  const session = launch ? await one("select * from public.create_game_session('test-game',$1)", [auth]) : null
  return { ...p, auth, session }
}
const body = (p, extra = {}) => ({ id: randomUUID(), kind: "compensation", title: "測試補償", body: "已確認異常，補回 POINT。", audience: "player", public_id: p.public_id, game_id: game, amount: "50", source_ref: "incident:mail-test", ...extra })
async function mail(p, extra = {}, send = true) {
  const request = body(p, extra)
  const prepared = await admin("prepare", request)
  if (send) await admin("send", { id: prepared.id })
  return { ...prepared, request }
}
const balance = p => one("select balance,locked_balance from public.wallet_accounts where player_account_id=$1", [p.player_account_id])

test("draft audience is invisible; send/read/claim have distinct states and claims retry exactly", async () => {
  const p = await player(), m = await mail(p, {}, false)
  assert.equal(m.recipient_count, 1)
  assert.equal(m.total_amount, "50.00")
  assert.equal((await member(p, "list")).items.length, 0)
  const sent = await admin("send", { id: m.id })
  assert.deepEqual(await admin("send", { id: m.id }), sent)
  assert.equal((await member(p, "list")).unread, 1)
  await member(p, "read", { id: m.id })
  assert.equal((await member(p, "list")).unread, 0)
  assert.equal((await balance(p)).balance, "1000.00")
  const claimed = await member(p, "claim", { id: m.id })
  assert.deepEqual(await member(p, "claim", { id: m.id }), claimed)
  assert.equal((await balance(p)).balance, "1050.00")
  const ledger = await one("select count(*)::int n, sum(amount)::text amount from public.wallet_transactions where source_type='mail_compensation' and wallet_account_id=(select id from public.wallet_accounts where player_account_id=$1)", [p.player_account_id])
  assert.deepEqual(ledger, { n: 1, amount: "50.00" })
  assert.equal((await admin("recipients", { id: m.id })).items[0].transaction_id, claimed.transaction_id)
})

test("one player's messages cannot be read or claimed by another; injected identity/amount rejected", async () => {
  const p = await player(), stranger = await player(), m = await mail(p)
  assert.equal((await member(stranger, "list")).items.length, 0)
  for (const action of ["read", "claim"]) await assert.rejects(member(stranger, action, { id: m.id }), /JOY8_MAIL_NOT_FOUND/)
  await assert.rejects(member(p, "claim", { id: m.id, amount: "999" }), /JOY8_INVALID_REQUEST/)
  await assert.rejects(member(p, "list", { player_account_id: stranger.player_account_id }), /JOY8_INVALID_REQUEST/)
})

test("prepare is exact-retry safe and rejects changed content; cancelled drafts cannot send", async () => {
  const p = await player(), m = await mail(p, {}, false)
  assert.equal((await admin("prepare", m.request)).recipient_count, 1)
  await assert.rejects(admin("prepare", { ...m.request, amount: "60" }), /JOY8_IDEMPOTENCY_CONFLICT/)
  await admin("cancel", { id: m.id })
  await admin("cancel", { id: m.id })
  await assert.rejects(admin("send", { id: m.id }), /JOY8_MAIL_STATE_CONFLICT/)
  assert.equal((await member(p, "list")).items.length, 0)
})

test("game audience snapshots existing participants and excludes later players; platform announcements remain visible in game filter", async () => {
  const p = await player(true), outsider = await player()
  const m = await mail(p, { kind: "announcement", amount: "0", source_ref: "", audience: "game", public_id: "" }, false)
  const late = await player(true)
  await admin("send", { id: m.id })
  assert.ok((await member(p, "list", { game_id: game })).items.some(item => item.id === m.id))
  for (const other of [outsider, late]) assert.ok(!(await member(other, "list")).items.some(item => item.id === m.id))
  const platform = await mail(p, { kind: "announcement", amount: "0", source_ref: "", game_id: "" })
  assert.ok((await member(p, "list", { game_id: game })).items.some(item => item.id === platform.id))
  await assert.rejects(member(p, "claim", { id: platform.id }), /JOY8_MAIL_NO_REWARD/)
})

test("all-player notices snapshot enrolled active players, with no future or suspended recipients", async () => {
  const p = await player(), suspended = await player()
  await db.query("update public.player_accounts set status='suspended' where id=$1", [suspended.player_account_id])
  const m = await mail(p, { audience: "all", public_id: "", kind: "notification", amount: "0", game_id: "", source_ref: "" })
  const late = await player()
  assert.ok((await member(p, "list")).items.some(item => item.id === m.id))
  assert.ok(!(await member(late, "list")).items.some(item => item.id === m.id))
  assert.equal((await one("select count(*)::int n from public.joy8_mail_recipients where message_id=$1 and player_account_id=$2", [m.id, suspended.player_account_id])).n, 0)
})

test("active match or frozen wallet blocks claim without consuming reward; completion permits it", async () => {
  const p = await player(true), m = await mail(p)
  await reserveMemberWallet(db, p.session, keys.get(game))
  await assert.rejects(member(p, "claim", { id: m.id }), /JOY8_WALLET_OCCUPIED/)
  assert.equal((await one("select claimed_at from public.joy8_mail_recipients where message_id=$1", [m.id])).claimed_at, null)
  await db.query("update public.joy8_matches set state='cancelled' where match_ref=$1", [p.session.session_id])
  await db.query("update public.wallet_accounts set locked_balance=0,status='frozen' where player_account_id=$1", [p.player_account_id])
  await assert.rejects(member(p, "claim", { id: m.id }), /JOY8_WALLET_INACTIVE/)
  await db.query("update public.wallet_accounts set status='active' where player_account_id=$1", [p.player_account_id])
  await member(p, "claim", { id: m.id })
  assert.equal((await balance(p)).balance, "1050.00")
})

test("ledger failure rolls back wallet and claim atomically", async () => {
  const p = await player(), m = await mail(p)
  await db.exec("create function public.mail_test_failure() returns trigger language plpgsql as $$ begin if new.source_type='mail_compensation' then raise exception 'injected ledger failure'; end if; return new; end $$; create trigger mail_test_failure before insert on public.wallet_transactions for each row execute function public.mail_test_failure(); revoke all on function public.mail_test_failure() from public;")
  try {
    await assert.rejects(member(p, "claim", { id: m.id }), /injected ledger failure/)
    assert.equal((await balance(p)).balance, "1000.00")
    assert.equal((await one("select claimed_at from public.joy8_mail_recipients where message_id=$1", [m.id])).claimed_at, null)
  } finally { await db.exec("drop trigger mail_test_failure on public.wallet_transactions; drop function public.mail_test_failure()") }
  await member(p, "claim", { id: m.id })
})

test("browser and game roles have no table writes or financial RPC grants; Google administrator identity enforced", async () => {
  for (const role of ["anon", "authenticated", "service_role"]) {
    assert.equal((await one("select has_table_privilege($1,'public.joy8_mail_messages','INSERT') allowed", [role])).allowed, false)
    assert.equal((await one("select has_table_privilege($1,'public.joy8_mail_recipients','UPDATE') allowed", [role])).allowed, false)
  }
  for (const role of ["anon", "authenticated"]) assert.equal((await one("select has_function_privilege($1,'public.joy8_member_mail(uuid,text,jsonb)','EXECUTE') allowed", [role])).allowed, false)
  assert.equal((await one("select has_function_privilege('service_role','public.joy8_admin_mail(text,jsonb)','EXECUTE') allowed")).allowed, false)
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ app_metadata: { provider: "email" } })])
  await assert.rejects(admin("list", {}), /JOY8_MAIL_FORBIDDEN/)
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ app_metadata: { provider: "google" } })])
})

test("validation rejects missing evidence, invalid amounts, empty audiences, unknown fields and unsafe pagination", async () => {
  const p = await player()
  for (const extra of [{ source_ref: "" }, { source_ref: {} }, { amount: "1.5" }, { amount: -1 }, { amount: "0" }, { game_id: randomUUID() }, { title: " " }, { injected: true }]) {
    await assert.rejects(admin("prepare", body(p, extra)), /JOY8_INVALID_REQUEST/)
  }
  const absent = (await one("select n::text id from generate_series(100000,999999) n where not exists(select 1 from public.player_accounts p where p.public_id=n::text) limit 1")).id
  await assert.rejects(admin("prepare", body(p, { public_id: absent })), /JOY8_MAIL_NO_RECIPIENTS/)
  await assert.rejects(member(p, "list", { offset: -1 }), /JOY8_INVALID_REQUEST/)
})

test("sent content and claimed receipt cannot be rewritten or deleted", async () => {
  const p = await player(), m = await mail(p)
  await member(p, "claim", { id: m.id })
  await assert.rejects(db.query("update public.joy8_mail_messages set body='changed' where id=$1", [m.id]), /JOY8_MAIL_IMMUTABLE/)
  await assert.rejects(db.query("delete from public.joy8_mail_messages where id=$1", [m.id]), /JOY8_MAIL_IMMUTABLE/)
  await assert.rejects(db.query("update public.joy8_mail_recipients set claimed_at=null,transaction_id=null where message_id=$1", [m.id]), /JOY8_MAIL_IMMUTABLE/)
})

test("platform event rewards need no game and preserve platform attribution", async () => {
  const p = await player(), m = await mail(p, { kind: "reward", game_id: "", source_ref: "event:anniversary" })
  const receipt = await member(p, "claim", { id: m.id })
  const transaction = await one("select game_id,source_type,source_ref from public.wallet_transactions where id=$1", [receipt.transaction_id])
  assert.deepEqual(transaction, { game_id: null, source_type: "mail_reward", source_ref: "event:anniversary" })
  assert.equal((await balance(p)).balance, "1050.00")
  await assert.rejects(admin("prepare", body(p, { audience: "game", public_id: "", game_id: "" })), /JOY8_INVALID_REQUEST/)
})

test("separate connections racing one reward commit exactly one ledger credit", { skip: !db.connect }, async () => {
  const p = await player(), m = await mail(p)
  const a = await db.connect(), b = await db.connect()
  try {
    const results = await Promise.all([member(p, "claim", { id: m.id }, a), member(p, "claim", { id: m.id }, b)])
    assert.deepEqual(results[0], results[1])
    assert.equal((await balance(p)).balance, "1050.00")
  } finally { await a.end(); await b.end() }
})

test("separate rewards racing the same wallet retain both credits", { skip: !db.connect }, async () => {
  const p = await player(), first = await mail(p), second = await mail(p)
  const a = await db.connect(), b = await db.connect()
  try {
    const results = await Promise.all([member(p, "claim", { id: first.id }, a), member(p, "claim", { id: second.id }, b)])
    assert.notEqual(results[0].transaction_id, results[1].transaction_id)
    assert.equal((await balance(p)).balance, "1100.00")
  } finally { await a.end(); await b.end() }
})

test("oversized audience aborts the entire draft and leaves no partial recipients", async () => {
  const p = await player(), request = body(p, { audience: "all", public_id: "" })
  await db.exec("begin")
  try {
    await db.exec("with users as (insert into auth.users(is_anonymous) select true from generate_series(1,5001) returning id) insert into public.player_accounts(auth_user_id,account_type,member_enrolled_at) select id,'guest',now() from users")
    await db.exec("savepoint before_preview")
    await assert.rejects(db.query("select public.joy8_admin_mail('prepare',$1)", [request]), /JOY8_MAIL_AUDIENCE_LIMIT/)
    await db.exec("rollback to savepoint before_preview")
    assert.equal((await one("select count(*)::int n from public.joy8_mail_messages where id=$1", [request.id])).n, 0)
    assert.equal((await one("select count(*)::int n from public.joy8_mail_recipients where message_id=$1", [request.id])).n, 0)
  } finally { await db.exec("rollback") }
})
