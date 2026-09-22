import { randomBytes, randomUUID, createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = fileURLToPath(new URL("../", import.meta.url))
const projectRef = "lsazydefvnuqglultqii"
const allowedScopes = ["exchange", "renew", "open", "settle", "status", "cancel"]
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function requiredString(value, name) {
  if (typeof value !== "string" || value.trim() !== value || !value) throw new Error(`Invalid ${name}`)
  return value
}

export function validateProfile(profile, now = new Date(), requireFutureExpiry = true) {
  if (!profile || typeof profile !== "object") throw new Error("Invalid integration profile")
  const gameId = requiredString(profile.game?.gameId, "game.gameId")
  const slug = requiredString(profile.game?.slug, "game.slug")
  if (!uuidPattern.test(gameId)) throw new Error("Invalid game.gameId")
  if (!slugPattern.test(slug)) throw new Error("Invalid game.slug")
  if (profile.platform?.protocol !== "server-v1") throw new Error("Only server-v1 is supported")
  if (profile.platform?.currency !== "POINT") throw new Error("Only POINT is supported")
  if (profile.credential?.purpose !== "private-integration") throw new Error("credential.purpose must be private-integration")
  if (profile.credential?.environmentVariable !== "JOY8_BACKEND_KEY") throw new Error("credential.environmentVariable must be JOY8_BACKEND_KEY")
  if (profile.credential?.delivery !== "secure-one-time") throw new Error("credential.delivery must be secure-one-time")
  const scopes = profile.credential?.scopes
  if (!Array.isArray(scopes) || scopes.length === 0 || new Set(scopes).size !== scopes.length || scopes.some(scope => !allowedScopes.includes(scope))) {
    throw new Error("Invalid credential.scopes")
  }
  const expiresAtText = requiredString(profile.credential?.expiresAt, "credential.expiresAt")
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(expiresAtText)) throw new Error("credential.expiresAt must be an ISO UTC timestamp")
  const expiresAt = new Date(expiresAtText)
  if (!Number.isFinite(expiresAt.valueOf()) || (requireFutureExpiry && expiresAt <= now)) throw new Error("credential.expiresAt must be a future ISO timestamp")
  return { gameId, slug, scopes: [...scopes], expiresAt: expiresAt.toISOString() }
}

export function validateDelivery(delivery) {
  if (!delivery || delivery.type !== "cloudflare-worker") throw new Error("Only cloudflare-worker delivery is supported")
  const cwd = requiredString(delivery.cwd, "delivery.cwd")
  const secretName = requiredString(delivery.secretName, "delivery.secretName")
  const workerName = requiredString(delivery.workerName, "delivery.workerName")
  if (!path.isAbsolute(cwd)) throw new Error("delivery.cwd must be an absolute path")
  if (secretName !== "JOY8_BACKEND_KEY") throw new Error("delivery.secretName must be JOY8_BACKEND_KEY")
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(workerName)) throw new Error("Invalid delivery.workerName")
  const deployMode = delivery.deployMode ?? "immediate"
  if (deployMode !== "immediate") throw new Error("delivery.deployMode must be immediate")
  const environment = delivery.environment == null ? null : requiredString(delivery.environment, "delivery.environment")
  const config = delivery.config == null ? null : requiredString(delivery.config, "delivery.config")
  if (environment && !/^[A-Za-z0-9_-]+$/.test(environment)) throw new Error("Invalid delivery.environment")
  return { type: delivery.type, cwd: path.resolve(cwd), secretName, workerName, deployMode, environment, config }
}

export function createBackendCredential(bytes = randomBytes(32), id = randomUUID()) {
  if (!Buffer.isBuffer(bytes) || bytes.length !== 32) throw new Error("Backend Key entropy must be exactly 32 bytes")
  if (!uuidPattern.test(id)) throw new Error("Invalid Backend Key ID")
  const secret = bytes.toString("hex")
  return { id, secret, hash: createHash("sha256").update(secret).digest("hex") }
}

function quote(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

export function buildRegisterSql(profile, credential) {
  const { gameId, slug, scopes, expiresAt } = validateProfile(profile)
  if (!credential || !uuidPattern.test(credential.id) || !/^[a-f0-9]{64}$/.test(credential.hash)) throw new Error("Invalid hashed credential")
  const scopeSql = scopes.map(quote).join(",")
  return `do $joy8$
declare v_game_id uuid;
begin
  select g.id into v_game_id from public.games g
  where g.id=${quote(gameId)}::uuid and g.slug=${quote(slug)} and not g.published
  for update;
  if not found then raise exception 'JOY8_KEY_GAME_NOT_HIDDEN_OR_MISMATCHED'; end if;
  perform 1 from public.joy8_game_policies gp
  join public.joy8_wallet_policies wp on wp.id=gp.wallet_policy_id
  where gp.game_id=v_game_id and gp.enabled and wp.enabled and wp.currency='POINT';
  if not found then raise exception 'JOY8_KEY_POLICY_NOT_READY'; end if;
  insert into public.joy8_backend_keys(id,game_id,key_hash,scopes,expires_at)
  values (${quote(credential.id)}::uuid,v_game_id,${quote(credential.hash)},array[${scopeSql}]::text[],${quote(expiresAt)}::timestamptz);
end
$joy8$;
select json_build_object('keyId',${quote(credential.id)},'gameId',${quote(gameId)},'slug',${quote(slug)},'expiresAt',${quote(expiresAt)}) as joy8_backend_key_registered;
`
}

export function buildRevokeSql(profile, keyId) {
  const { gameId, slug } = validateProfile(profile, new Date(), false)
  if (!uuidPattern.test(keyId)) throw new Error("Invalid Backend Key ID")
  return `do $joy8$
begin
  if not exists (select 1 from public.joy8_backend_keys k join public.games g on g.id=k.game_id
    where k.id=${quote(keyId)}::uuid and k.game_id=${quote(gameId)}::uuid and g.slug=${quote(slug)}) then
    raise exception 'JOY8_KEY_NOT_FOUND';
  end if;
  update public.joy8_backend_keys set revoked_at=coalesce(revoked_at,now())
  where id=${quote(keyId)}::uuid and game_id=${quote(gameId)}::uuid;
end
$joy8$;
select json_build_object('keyId',${quote(keyId)},'gameId',${quote(gameId)},'revoked',true) as joy8_backend_key_revoked;
`
}

export function buildStatusSql(profile) {
  const { gameId, slug } = validateProfile(profile, new Date(), false)
  return `select coalesce(json_agg(json_build_object(
  'keyId',k.id,'scopes',k.scopes,'expiresAt',k.expires_at,'revokedAt',k.revoked_at,'createdAt',k.created_at
) order by k.created_at desc),'[]'::json) as joy8_backend_keys
from public.joy8_backend_keys k join public.games g on g.id=k.game_id
where k.game_id=${quote(gameId)}::uuid and g.slug=${quote(slug)};
`
}

export function cloudflareSecretArgs(delivery, wranglerBin) {
  const checked = validateDelivery(delivery)
  const args = [wranglerBin, "secret", "put", checked.secretName, "--name", checked.workerName]
  if (checked.environment) args.push("--env", checked.environment)
  if (checked.config) args.push("--config", checked.config)
  return args
}

export async function resolveWranglerBin(cwd) {
  const packageRoot = path.join(path.resolve(cwd), "node_modules", "wrangler")
  const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8").catch(() => {
    throw new Error("Target backend must install Wrangler locally before secret delivery")
  }))
  const relativeBin = typeof packageJson.bin === "string" ? packageJson.bin : packageJson.bin?.wrangler
  if (typeof relativeBin !== "string") throw new Error("Local Wrangler package has no executable")
  const bin = path.resolve(packageRoot, relativeBin)
  const relative = path.relative(packageRoot, bin)
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Invalid local Wrangler executable")
  await readFile(bin).catch(() => { throw new Error("Local Wrangler executable is unavailable") })
  return bin
}

export async function deliverCloudflareSecret(delivery, secret) {
  const checked = validateDelivery(delivery)
  if (!/^[a-f0-9]{64}$/.test(secret)) throw new Error("Invalid Backend Key")
  const wranglerBin = await resolveWranglerBin(checked.cwd)
  const result = spawnSync(process.execPath, cloudflareSecretArgs(checked, wranglerBin), {
    cwd: checked.cwd,
    input: `${secret}\n`,
    encoding: "utf8",
    windowsHide: true,
    stdio: ["pipe", "ignore", "ignore"]
  })
  if (result.error || result.status !== 0) throw new Error("Cloudflare rejected Backend Key delivery; no secret output was retained")
}

export async function provisionCredential({ profile, delivery, oldKeyId = null, registerKey, deliverKey, revokeKey, credentialFactory = createBackendCredential }) {
  validateProfile(profile)
  validateDelivery(delivery)
  if (oldKeyId !== null && !uuidPattern.test(oldKeyId)) throw new Error("Invalid old Backend Key ID")
  const credential = credentialFactory()
  await registerKey({ id: credential.id, hash: credential.hash })
  try {
    await deliverKey(credential.secret)
  } catch {
    try {
      await revokeKey(credential.id)
    } catch {
      throw new Error(`Backend Key delivery failed and compensation failed; revoke key ID ${credential.id}`)
    }
    throw new Error(`Backend Key delivery failed; new key ID ${credential.id} was revoked`)
  }
  if (oldKeyId) {
    try {
      await revokeKey(oldKeyId)
    } catch {
      throw new Error(`New Backend Key ${credential.id} is active, but old key ${oldKeyId} still requires revocation`)
    }
  }
  return { keyId: credential.id, gameId: profile.game.gameId, delivered: true, oldKeyRevoked: Boolean(oldKeyId) }
}

function runPowerShell(args) {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(root, "scripts", "supabase-joy8.ps1"), ...args], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true
  })
  if (result.error || result.status !== 0) throw new Error("Joy8 Supabase command failed; inspect the local operator terminal")
  return result.stdout
}

function verifyProjectLink() {
  const output = runPowerShell(["projects", "list", "--output", "json"])
  const start = output.indexOf("[")
  const end = output.lastIndexOf("]")
  if (start < 0 || end < start) throw new Error("Could not verify the linked Joy8 Supabase project")
  const projects = JSON.parse(output.slice(start, end + 1))
  const project = projects.find(item => item.id === projectRef || item.ref === projectRef)
  if (!project || project.name !== "Joy8" || project.linked !== true) throw new Error("Joy8 / lsazydefvnuqglultqii is not the linked Supabase project")
}

async function withTemporarySql(sql, callback) {
  const tempRoot = path.resolve(os.tmpdir())
  const directory = await mkdtemp(path.join(tempRoot, "joy8-backend-key-"))
  const file = path.join(directory, "operation.sql")
  try {
    await writeFile(file, sql, { encoding: "utf8", mode: 0o600 })
    return await callback(file)
  } finally {
    const resolved = path.resolve(directory)
    if (path.dirname(resolved) !== tempRoot || !path.basename(resolved).startsWith("joy8-backend-key-")) throw new Error("Refused unsafe temporary cleanup")
    await rm(resolved, { recursive: true, force: true })
  }
}

export async function runJoy8Sql(sql) {
  verifyProjectLink()
  const rawUrl = (await readFile(path.join(root, "supabase", ".temp", "pooler-url"), "utf8")).trim()
  const dbUrl = new URL(rawUrl)
  if (dbUrl.protocol !== "postgresql:" || !dbUrl.hostname.endsWith(".pooler.supabase.com") || !dbUrl.username.includes(projectRef) || dbUrl.password) {
    throw new Error("Joy8 pooler URL is missing or unsafe")
  }
  return withTemporarySql(sql, file => runPowerShell(["db", "query", "--db-url", dbUrl.toString(), "--file", file]))
}

function parseArgs(argv) {
  const [command, ...rest] = argv
  const values = { command, apply: false }
  for (let index = 0; index < rest.length; index += 1) {
    const item = rest[index]
    if (item === "--apply") values.apply = true
    else if (item.startsWith("--")) {
      const value = rest[index + 1]
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${item}`)
      values[item.slice(2).replaceAll("-", "_")] = value
      index += 1
    } else throw new Error(`Unexpected argument ${item}`)
  }
  return values
}

async function readJson(file, name) {
  if (!file) throw new Error(`Missing --${name}`)
  return JSON.parse(await readFile(path.resolve(file), "utf8"))
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!["plan", "provision", "rotate", "status", "revoke"].includes(args.command)) {
    throw new Error("Use plan, provision, rotate, status or revoke")
  }
  const profile = await readJson(args.profile, "profile")
  const checked = validateProfile(profile, new Date(), !["status", "revoke"].includes(args.command))
  if (args.command === "status") {
    process.stdout.write(await runJoy8Sql(buildStatusSql(profile)))
    return
  }
  if (args.command === "revoke") {
    if (!args.apply) throw new Error("Revoke is a remote change; review first, then add --apply")
    process.stdout.write(await runJoy8Sql(buildRevokeSql(profile, args.key_id)))
    return
  }
  const delivery = await readJson(args.delivery, "delivery")
  const checkedDelivery = validateDelivery(delivery)
  if (args.command === "plan") {
    console.log(JSON.stringify({ action: "provision", gameId: checked.gameId, slug: checked.slug, scopes: checked.scopes, expiresAt: checked.expiresAt, target: { type: checkedDelivery.type, workerName: checkedDelivery.workerName, secretName: checkedDelivery.secretName, deployMode: checkedDelivery.deployMode }, remoteChanges: false }, null, 2))
    return
  }
  if (!args.apply) throw new Error("Provisioning is a remote change; run plan first, then add --apply")
  if (args.command === "rotate" && !args.old_key_id) throw new Error("Rotate requires --old-key-id")
  const result = await provisionCredential({
    profile,
    delivery,
    oldKeyId: args.command === "rotate" ? args.old_key_id : null,
    registerKey: credential => runJoy8Sql(buildRegisterSql(profile, credential)),
    deliverKey: secret => deliverCloudflareSecret(delivery, secret),
    revokeKey: keyId => runJoy8Sql(buildRevokeSql(profile, keyId))
  })
  console.log(JSON.stringify(result, null, 2))
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(error => {
    console.error(`Backend Key operation stopped: ${error.message}`)
    process.exitCode = 1
  })
}
