import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { createLocalPostgres } from "./fixtures/local-postgres.mjs"
import { loadCurrentPlatform } from "./fixtures/platform-bundle.mjs"

const db = await createLocalPostgres()
const one = async (sql, values = []) => (await db.query(sql, values)).rows[0]
before(async () => {
  await loadCurrentPlatform(db)
})
after(() => db.close())

test("held candidate and former global lock do not block another enrollment", async () => {
  const gate = await db.connect()
  const client = await db.connect()
  try {
    await gate.query("begin; select setseed(0.31)")
    const held = (await gate.query("insert into public.player_accounts(account_type) values('guest') returning public_id")).rows[0].public_id
    await gate.query("select pg_advisory_xact_lock(75080001)")
    await client.query("set statement_timeout=2000; select setseed(0.31)")
    const auth = await one("insert into auth.users(is_anonymous) values(true) returning id")
    await client.query("set role service_role")
    const member = (await client.query("select * from public.joy8_resolve_member_profile($1,true)", [auth.id])).rows[0]
    assert.match(member.public_id, /^[1-9][0-9]{5}$/)
    assert.notEqual(member.public_id, held)
    await gate.query("commit")
    assert.equal((await one("select count(*)::int n from public.player_accounts where public_id=any($1)", [[held, member.public_id]])).n, 2)
  } finally {
    await gate.query("rollback")
    await gate.end()
    await client.end()
  }
})

test("concurrent enrollments with identical candidate sequences remain unique", async () => {
  const clients = await Promise.all(Array.from({ length: 12 }, () => db.connect()))
  try {
    const identities = []
    for (const client of clients) identities.push((await client.query("insert into auth.users(is_anonymous) values(true) returning id")).rows[0])
    await Promise.all(clients.map(client => client.query("begin; set local role service_role; select setseed(0.72)")))
    const members = await Promise.all(clients.map(async (client, index) => {
      const member = (await client.query("select * from public.joy8_resolve_member_profile($1,true)", [identities[index].id])).rows[0]
      return member
    }))
    assert.equal(new Set(members.map(member => member.public_id)).size, clients.length)
    await Promise.all(clients.map(client => client.query("commit")))
    const saved = (await db.query("select public_id from public.player_accounts where auth_user_id=any($1)", [identities.map(identity => identity.id)])).rows
    assert.equal(saved.length, clients.length)
    assert.equal(new Set(saved.map(player => player.public_id)).size, clients.length)
  } finally {
    await Promise.allSettled(clients.map(async client => { await client.query("rollback"); await client.end() }))
  }
})

test("rolled-back allocation releases its candidate without changing existing IDs", async () => {
  const gate = await db.connect()
  try {
    await gate.query("begin; select setseed(0.19)")
    const first = (await gate.query("insert into public.player_accounts(account_type) values('guest') returning public_id")).rows[0].public_id
    await gate.query("rollback; select setseed(0.19)")
    const retry = (await gate.query("insert into public.player_accounts(account_type) values('guest') returning public_id")).rows[0].public_id
    assert.equal(retry, first)
    await gate.query("select setseed(0.19)")
    const next = (await gate.query("insert into public.player_accounts(account_type) values('guest') returning public_id")).rows[0].public_id
    assert.notEqual(next, retry)
    assert.equal((await one("select count(*)::int n from public.player_accounts where public_id=$1", [retry])).n, 1)
  } finally { await gate.end() }
})
