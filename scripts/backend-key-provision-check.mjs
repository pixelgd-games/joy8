import assert from "node:assert/strict"
import { test } from "node:test"
import {
  buildRegisterSql,
  buildRevokeSql,
  buildStatusSql,
  cloudflareSecretArgs,
  createBackendCredential,
  credentialPlan,
  verifyCredentialPlan,
  provisionCredential,
  validateDelivery,
  validateProfile
} from "./backend-key-provision.mjs"
import { createTestDatabase } from "./fixtures/test-database.mjs"
import { loadCurrentPlatform } from "./fixtures/platform-bundle.mjs"

const gameId = "11111111-1111-4111-8111-111111111111"
const keyId = "22222222-2222-4222-8222-222222222222"
const oldKeyId = "33333333-3333-4333-8333-333333333333"
const secret = "00".repeat(32)
const hash = "60e05bd1b195af2f94112fa7197a5c88289058840ce7c6df9693756bc6250f55"
const profile = {
  game: { name: "Example", slug: "example-game", gameId },
  platform: { protocol: "server-v1", currency: "POINT" },
  credential: {
    purpose: "private-integration",
    environmentVariable: "JOY8_BACKEND_KEY",
    delivery: "secure-one-time",
    scopes: ["exchange", "renew", "open", "settle", "status", "cancel"]
  }
}
const delivery = {
  type: "cloudflare-worker",
  secretName: "JOY8_BACKEND_KEY",
  workerName: "example-api",
  cwd: "D:/provider/backend",
  deployMode: "immediate",
  environment: null,
  config: null
}
const fixedCredential = () => ({ id: keyId, secret, hash })

test("review binds credential operation, scope, old key and exact delivery target", () => {
  const plan = credentialPlan({ operation: "rotate", profile, delivery, keyId: oldKeyId })
  assert.doesNotThrow(() => verifyCredentialPlan(plan, structuredClone(plan)))
  for (const changed of [
    { ...plan, keyId }, { ...plan, scopes: ["exchange"] },
    { ...plan, target: { ...plan.target, environment: "production" } },
    { ...plan, operation: "provision" },
  ]) assert.throws(() => verifyCredentialPlan(plan, changed), /does not match/)
  assert.equal(JSON.stringify(plan).includes(secret), false)
  assert.throws(() => credentialPlan({ operation: "rotate", profile, delivery }), /exact key/)
})

test("validates a restricted non-secret profile and explicit Cloudflare target", () => {
  assert.deepEqual(validateProfile(profile).scopes, profile.credential.scopes)
  assert.equal(validateDelivery(delivery).deployMode, "immediate")
  assert.throws(() => validateProfile({ ...profile, credential: { ...profile.credential, purpose: "unknown" } }), /purpose/)
  assert.throws(() => validateDelivery({ ...delivery, cwd: "relative/backend" }), /absolute path/)
  assert.throws(() => validateProfile({ ...profile, credential: { ...profile.credential, expiresAt: "2099-01-01T00:00:00Z" } }), /do not expire/)
})

test("creates a 256-bit Backend Key and hashes the plaintext once for storage", () => {
  assert.deepEqual(createBackendCredential(Buffer.alloc(32), keyId), { id: keyId, secret, hash })
  const sql = buildRegisterSql(profile, { id: keyId, hash })
  assert.match(sql, new RegExp(hash))
  assert.equal(sql.includes(secret), false)
  assert.equal(buildStatusSql(profile).includes("key_hash"), false)
})

test("constructs a local Wrangler command without putting the secret in arguments", () => {
  const args = cloudflareSecretArgs(delivery, "D:/provider/backend/node_modules/wrangler/bin/wrangler.js")
  assert.deepEqual(args.slice(1), ["secret", "put", "JOY8_BACKEND_KEY", "--name", "example-api"])
  assert.equal(args.join(" ").includes(secret), false)
  const environmentArgs = cloudflareSecretArgs({ ...delivery, environment: "staging" }, "wrangler.js")
  assert.deepEqual(environmentArgs.slice(-2), ["--env", "staging"])
  assert.throws(() => validateDelivery({ ...delivery, deployMode: "version-only" }), /must be immediate/)
})

test("registers, reports and revokes only non-secret key metadata", async () => {
  const db = await createTestDatabase()
  try {
    await loadCurrentPlatform(db)
    await db.query("insert into public.games(id,name,slug,type,published,launch_url) values($1,'Example','example-game','slot',false,'https://game.example/')", [gameId])
    const policy = (await db.query("select id from public.joy8_wallet_policies where currency='POINT'")).rows[0].id
    await db.query("insert into public.joy8_game_policies(game_id,wallet_policy_id,enabled,max_bet_amount,max_payout_amount,max_participants) values($1,$2,true,10000,10000,1)", [gameId, policy])
    await db.exec(buildRegisterSql(profile, { id: keyId, hash }))
    const stored = (await db.query("select id,key_hash,revoked_at from public.joy8_backend_keys where id=$1", [keyId])).rows[0]
    assert.equal(stored.key_hash, hash)
    assert.equal(stored.revoked_at, null)
    const status = (await db.query(buildStatusSql(profile))).rows[0].joy8_backend_keys
    assert.equal(status[0].keyId, keyId)
    assert.equal(JSON.stringify(status).includes(hash), false)
    assert.equal(Object.hasOwn(status[0], "expiresAt"), false)
    const production = { ...profile, credential: { ...profile.credential, purpose: "production" } }
    await db.query("update public.games set published=true where id=$1", [gameId])
    assert.throws(() => buildRegisterSql(production, { id: oldKeyId, hash }), /rotation/)
    await db.exec(buildRegisterSql(production, { id: oldKeyId, hash: "ab".repeat(32) }, keyId))
    assert.equal((await db.query("select game_id from public.joy8_backend_keys where id=$1", [oldKeyId])).rows[0].game_id, gameId)
    assert.ok((await db.query("select revoked_at from public.joy8_backend_keys where id=$1", [keyId])).rows[0].revoked_at)
    assert.deepEqual((await db.query("select id from public.joy8_backend_keys where game_id=$1 and revoked_at is null", [gameId])).rows.map(row => row.id), [oldKeyId])
    await assert.rejects(db.query("select expires_at from public.joy8_backend_keys"), /expires_at/)
    await db.exec(buildRevokeSql(profile, keyId))
  } finally {
    await db.close()
  }
})

test("rotation replaces the old key in registration and never keeps both active", async () => {
  const events = []
  const result = await provisionCredential({
    profile,
    delivery,
    oldKeyId,
    credentialFactory: fixedCredential,
    registerKey: async value => events.push(["register", value.id, value.hash]),
    deliverKey: async value => events.push(["deliver", value]),
    revokeKey: async value => events.push(["revoke", value])
  })
  assert.deepEqual(events.map(event => event[0]), ["register", "deliver"])
  assert.deepEqual(result, { keyId, gameId, delivered: true, oldKeyRevoked: true })
  assert.equal(JSON.stringify(result).includes(secret), false)
  assert.equal(JSON.stringify(result).includes(hash), false)
})

test("delivery failure revokes the new key and never exposes the plaintext", async () => {
  const revoked = []
  await assert.rejects(provisionCredential({
    profile,
    delivery,
    credentialFactory: fixedCredential,
    registerKey: async () => {},
    deliverKey: async () => { throw new Error(`provider echoed ${secret}`) },
    revokeKey: async value => revoked.push(value)
  }), error => {
    assert.equal(error.message.includes(secret), false)
    assert.equal(error.message.includes(hash), false)
    assert.match(error.message, new RegExp(keyId))
    return true
  })
  assert.deepEqual(revoked, [keyId])
})
